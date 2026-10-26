-- =============================================================================
-- A demo client in one click: a Kosovo supermarket in euro, with data in every
-- module — stock and purchasing, the tills day by day, wholesale customers,
-- a bakery, assets, staff and payroll, VAT, CRM, cards and promotions.
--   platform_create_demo_client(p)  makes the client and its catalogue (step 1)
--   platform_demo_fill(company, n)  fills the rest, one step per call, so no
--                                   call runs long (the panel calls them in turn)
-- Everything is dated back from the day it is made, as if the shop has been
-- trading for two months.
-- =============================================================================

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;

-- the time documents are stamped with; the demo loader sets app.demo_clock to make past days
create or replace function app.clock()
returns timestamptz language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('app.demo_clock', true), '')::timestamptz, now())
$$;

do $$ begin
  if position('app.clock()' in pg_get_functiondef('public.close_pos_session'::regproc)) = 0 then
    perform app._patch_function('public.close_pos_session', 'v_date := (now() at time zone v_tz)::date;', 'v_date := (app.clock() at time zone v_tz)::date;');
    perform app._patch_function('public.close_pos_session', 'closed_at = now()', 'closed_at = app.clock()');
  end if;
  if position('app.clock()' in pg_get_functiondef('public.post_delivery'::regproc)) = 0 then
    perform app._patch_function('public.post_delivery', 'v_at := now();', 'v_at := app.clock();');
    perform app._patch_function('public.post_delivery', 'done_at = now(),', 'done_at = app.clock(),');
  end if;
  if position('app.clock()' in pg_get_functiondef('public.pos_cash_move'::regproc)) = 0 then
    perform app._patch_function('public.pos_cash_move', '(now() at time zone v_tz)::date, ''pos_session''', '(app.clock() at time zone v_tz)::date, ''pos_session''');
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------------------------
create or replace function app.demo_var(p_co uuid, p_sku text) returns uuid language sql stable set search_path = '' as $$
  select id from public.product_variants where company_id = p_co and sku = p_sku and deleted_at is null
$$;
create or replace function app.demo_partner(p_co uuid, p_code text) returns uuid language sql stable set search_path = '' as $$
  select id from public.business_partners where company_id = p_co and code = p_code and deleted_at is null
$$;
create or replace function app.demo_acc(p_co uuid, p_code text) returns uuid language sql stable set search_path = '' as $$
  select id from public.accounts where company_id = p_co and code = p_code
$$;
create or replace function app.demo_tax(p_co uuid, p_code text) returns uuid language sql stable set search_path = '' as $$
  select id from public.tax_codes where company_id = p_co and code = p_code and deleted_at is null limit 1
$$;
create or replace function app.demo_loc(p_co uuid, p_code text) returns uuid language sql stable set search_path = '' as $$
  select id from public.warehouse_locations where company_id = p_co and code = p_code and deleted_at is null
$$;
create or replace function app.demo_wh(p_co uuid, p_code text) returns uuid language sql stable set search_path = '' as $$
  select id from public.warehouses where company_id = p_co and code = p_code and deleted_at is null
$$;

-- a manual journal entry, as an accountant would type it: [[account code, debit, credit], ...]
create or replace function app.demo_journal(p_co uuid, p_journal text, p_date date, p_ref text, p_memo text, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_je uuid; l jsonb; n int := 0;
begin
  insert into public.journal_entries (company_id, journal_id, entry_date, reference, memo)
  values (p_co, (select id from public.journals where company_id = p_co and code = p_journal), p_date, p_ref, p_memo) returning id into v_je;
  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    insert into public.journal_lines (company_id, entry_id, line_no, account_id, debit, credit)
    values (p_co, v_je, n, app.demo_acc(p_co, l ->> 0), (l ->> 1)::numeric, (l ->> 2)::numeric);
  end loop;
  update public.journal_entries set status = 'posted' where id = v_je;
  return v_je;
end $$;

-- the catalogue: category, code, name, unit, shelf price with VAT, VAT %, cost share, supplier, sold per day (both tills)
create or replace function app.demo_catalog()
returns table (cat text, code text, name text, uom text, price numeric, vat int, cost_pct numeric, vendor text, per_day numeric)
language sql immutable set search_path = '' as $$
  select * from (values
    ('BUL','QUM-28','Qumësht i freskët 2,8% 1 L','pcs',0.99,8,0.78,'F02',40), ('BUL','QUM-15','Qumësht i freskët 1,5% 1 L','pcs',0.95,8,0.78,'F02',18),
    ('BUL','KOS-1','Kos shtëpie 1 kg','pcs',1.60,8,0.74,'F02',14), ('BUL','JOG-05','Jogurt i lehtë 0,5 L','pcs',0.70,8,0.75,'F02',16),
    ('BUL','DJA-B','Djathë i bardhë lope','kg',5.90,8,0.72,'F02',4), ('BUL','KAC-400','Kaçkavall 400 g','pcs',3.80,18,0.73,'F02',5),
    ('BUL','GJA-250','Gjalpë 250 g','pcs',2.40,18,0.76,'F02',4), ('BUL','AJK-400','Ajkë qumështi 400 g','pcs',2.10,8,0.75,'F02',5),
    ('BUL','VEZ-10','Vezë fshati, 10 copë','pcs',1.90,8,0.77,'F02',12),
    ('PIJ','UJE-15','Ujë natyral 1,5 L','pcs',0.40,8,0.62,'F01',45), ('PIJ','UJE-05','Ujë natyral 0,5 L','pcs',0.30,8,0.60,'F01',30),
    ('PIJ','UJM-1','Ujë mineral me gaz 1 L','pcs',0.55,8,0.62,'F01',14), ('PIJ','COL-2','Pije e gazuar kola 2 L','pcs',1.80,18,0.70,'F01',16),
    ('PIJ','LPO-1','Lëng portokalli 100% 1 L','pcs',1.40,18,0.71,'F01',8), ('PIJ','LMO-1','Lëng molle 1 L','pcs',1.30,18,0.71,'F01',7),
    ('PIJ','BIR-K05','Birrë e lehtë, kanaçe 0,5 L','pcs',0.95,18,0.72,'F01',30), ('PIJ','BIR-S033','Birrë e lehtë, shishe 0,33 L','pcs',0.85,18,0.72,'F01',14),
    ('PIJ','VER-K75','Verë e kuqe vendi 0,75 L','pcs',6.50,18,0.68,'F01',3), ('PIJ','ENE-025','Pije energjetike 0,25 L','pcs',1.10,18,0.70,'F01',12),
    ('PIJ','CAJ-15','Çaj i ftohtë pjeshke 1,5 L','pcs',1.20,18,0.70,'F01',8),
    ('BUK','BUK-500','Bukë shtëpie 500 g','pcs',0.50,8,0.00,'',70), ('BUK','BUK-INT','Bukë integrale 400 g','pcs',0.80,8,0.00,'',18),
    ('BUK','KRO-COK','Kroasan me çokollatë','pcs',0.60,18,0.62,'F05',20),
    ('MIS','PUL-KG','Pulë e plotë e freskët','kg',3.20,8,0.80,'F04',9), ('MIS','FIL-PUL','Fileto pule','kg',5.90,8,0.78,'F04',6),
    ('MIS','MIS-GRI','Mish viçi i grirë','kg',8.50,8,0.77,'F04',5), ('MIS','SUX-1','Suxhuk viçi 1 kg','pcs',7.90,18,0.74,'F04',3),
    ('MIS','SAL-500','Sallam pule 500 g','pcs',2.30,18,0.74,'F04',8), ('MIS','PRO-200','Proshutë viçi e tymosur 200 g','pcs',2.60,18,0.72,'F04',4),
    ('FRU','DOM-KG','Domate','kg',1.20,8,0.70,'F03',14), ('FRU','SPE-KG','Speca të gjelbër','kg',1.40,8,0.70,'F03',8),
    ('FRU','KAS-KG','Kastraveca','kg',0.90,8,0.70,'F03',8), ('FRU','PAT-KG','Patate','kg',0.60,8,0.68,'F03',20),
    ('FRU','QEP-KG','Qepë','kg',0.70,8,0.68,'F03',10), ('FRU','MOL-KG','Mollë','kg',1.10,8,0.70,'F03',12),
    ('FRU','BAN-KG','Banane','kg',1.50,8,0.74,'F03',12), ('FRU','POR-KG','Portokall','kg',1.30,8,0.72,'F03',9),
    ('FRU','LIM-KG','Limon','kg',2.20,8,0.70,'F03',3),
    ('BAZ','MIE-5','Miell tip 500, 5 kg','pcs',3.90,8,0.80,'F07',6), ('BAZ','VAJ-1','Vaj luledielli 1 L','pcs',1.95,8,0.80,'F05',12),
    ('BAZ','SHE-1','Sheqer i bardhë 1 kg','pcs',0.99,8,0.82,'F05',12), ('BAZ','KRI-1','Kripë kuzhine 1 kg','pcs',0.35,8,0.70,'F05',4),
    ('BAZ','ORI-1','Oriz 1 kg','pcs',1.60,18,0.75,'F05',6), ('BAZ','MAK-500','Makarona spageti 500 g','pcs',0.75,18,0.72,'F05',14),
    ('BAZ','FAS-1','Fasule e bardhë 1 kg','pcs',2.20,18,0.74,'F05',4), ('BAZ','PEL-680','Pelte domate 680 g','pcs',1.30,18,0.72,'F05',6),
    ('BAZ','KAF-T200','Kafe turke e bluar 200 g','pcs',2.80,18,0.73,'F05',12), ('BAZ','KAF-E1','Kafe espresso kokërr 1 kg','pcs',14.50,18,0.70,'F05',1),
    ('BAZ','CAJ-M50','Çaj mali 50 g','pcs',1.20,18,0.70,'F05',4),
    ('EMB','COK-100','Çokollatë qumështi 100 g','pcs',1.20,18,0.70,'F05',16), ('EMB','BIS-300','Biskota me tërshërë 300 g','pcs',1.40,18,0.70,'F05',8),
    ('EMB','CIP-150','Patatina me kripë 150 g','pcs',1.30,18,0.68,'F05',14), ('EMB','NAP-500','Napolitanka me krem 500 g','pcs',2.10,18,0.70,'F05',5),
    ('EMB','KIK-200','Kikirikë të pjekur 200 g','pcs',1.50,18,0.68,'F05',6), ('EMB','CAM-1','Çamçakëz me mente','pcs',0.50,18,0.60,'F05',12),
    ('HIG','SHA-400','Shampo flokësh 400 ml','pcs',3.20,18,0.68,'F06',3), ('HIG','SAP-100','Sapun me aloe 100 g','pcs',0.80,18,0.65,'F06',5),
    ('HIG','PAS-75','Pastë dhëmbësh 75 ml','pcs',1.90,18,0.66,'F06',4), ('HIG','LET-10','Letër higjienike, 10 role','pcs',3.90,18,0.72,'F06',8),
    ('HIG','PEL-50','Pelena për bebe, 50 copë','pcs',11.90,18,0.75,'F06',2), ('HIG','DEO-150','Deodorant 150 ml','pcs',2.90,18,0.66,'F06',3),
    ('PAS','DET-3','Detergjent rrobash 3 kg','pcs',8.90,18,0.72,'F06',2), ('PAS','DEN-1','Detergjent enësh 1 L','pcs',1.70,18,0.68,'F06',5),
    ('PAS','ZBA-1','Zbardhues 1 L','pcs',1.10,18,0.66,'F06',4), ('PAS','QES-20','Qese mbeturinash, 20 copë','pcs',1.50,18,0.62,'F06',5),
    ('PAS','PDY-1','Pastrues dyshemeje 1 L','pcs',2.30,18,0.66,'F06',3)
  ) x(cat, code, name, uom, price, vat, cost_pct, vendor, per_day)
$$;

-- the shop opened on the first day of last month: everything in the demo happens from then on
create or replace function app.demo_days() returns int language sql stable set search_path = '' as $$
  select current_date - (date_trunc('month', current_date) - interval '1 month')::date
$$;

-- how much more the tills really sell than the catalogue's "per day" (baskets carry more than one of a thing)
create or replace function app.demo_k(p_code text) returns numeric language sql immutable set search_path = '' as $$
  select case p_code when 'UJE-15' then 3.6 else 2.2 end
$$;

-- ---------------------------------------------------------------------------------------------
-- step 1: the client, its shop, catalogue, partners, people, cards and promotions
-- ---------------------------------------------------------------------------------------------
create or replace function app.demo_base(co uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r record; v_prod uuid; v_var uuid; v_mkt uuid; v_floor uuid; v_back uuid; v_kg uuid; v_pcs uuid; v_cat uuid; v_drawer uuid; v_pl uuid;
        v_dep record; v_emp uuid; d date := current_date; v_flour uuid; v_yeast uuid; v_salt uuid; v_flour_i uuid; v_bom uuid;
begin
  update public.companies set legal_name = coalesce(legal_name, name || ' L.L.C.'), tax_number = coalesce(tax_number, '811' || lpad((floor(random() * 999999))::text, 6, '0')),
         vat_number = coalesce(vat_number, '330' || lpad((floor(random() * 999999))::text, 6, '0')), business_number = coalesce(business_number, '7' || lpad((floor(random() * 9999999))::text, 8, '0')),
         address_line1 = 'Rr. Agim Ramadani 45', city = 'Prishtinë', postal_code = '10000', phone = '+383 38 220 450', email = 'info@market-demo.com', timezone = 'Europe/Belgrade'
   where id = co;
  update public.warehouses set name = 'Magazina qendrore', warehouse_type = 'warehouse', address_line1 = 'Zona Industriale, Rr. B', city = 'Prishtinë' where company_id = co and code = 'WH';
  insert into public.warehouses (company_id, code, name, warehouse_type, address_line1, city, country_code)
  values (co, 'MKT', 'Market Dardania', 'store', 'Rr. Agim Ramadani 45', 'Prishtinë', 'XK') returning id into v_mkt;
  insert into public.warehouse_locations (company_id, warehouse_id, code, name, location_type, barcode)
  values (co, v_mkt, 'MKT/SALLA', 'Salla e shitjes', 'internal', 'LOC-SALLA') returning id into v_floor;
  insert into public.warehouse_locations (company_id, warehouse_id, code, name, location_type, barcode, is_pickable)
  values (co, v_mkt, 'MKT/DEPO', 'Depoja e marketit', 'internal', 'LOC-DEPO', false) returning id into v_back;
  insert into public.warehouse_locations (company_id, warehouse_id, code, name, location_type, barcode)
  values (co, app.demo_wh(co, 'WH'), 'WH/FRIGO', 'Dhoma frigoriferike', 'internal', 'LOC-FRIGO');
  update public.company_settings set default_warehouse_id = app.demo_wh(co, 'WH'), default_sales_tax_code_id = app.demo_tax(co, 'VAT18'),
         default_purchase_tax_code_id = app.demo_tax(co, 'VAT18'), max_discount_pct = 15,
         invoice_footer = 'Llogaria bankare: ProCredit Bank 1110 2400 0012 3456 · Faleminderit për bashkëpunimin!'
   where company_id = co;
  update public.bank_accounts set name = 'ProCredit Bank — llogaria rrjedhëse', bank_name = 'ProCredit Bank', iban = 'XK05 1110 2400 0012 3456' where company_id = co and account_kind = 'bank';
  update public.bank_accounts set name = 'Arka kryesore' where company_id = co and account_kind = 'cash';
  insert into public.bank_accounts (company_id, name, account_kind, currency_code, account_id, journal_id)
  values (co, 'Sirtarët e arkave — Market', 'cash', 'EUR', app.demo_acc(co, '5311'), (select id from public.journals where company_id = co and code = 'POS'))
  returning id into v_drawer;

  -- categories and products
  select id into v_pcs from public.units_of_measure where company_id = co and code = 'pcs';
  select id into v_kg from public.units_of_measure where company_id = co and code = 'kg';
  for r in select * from (values ('BUL','Bulmet dhe vezë'),('PIJ','Pije'),('BUK','Bukë dhe furrë'),('MIS','Mish dhe sallam'),('FRU','Fruta dhe perime'),
                                  ('BAZ','Ushqime bazë'),('EMB','Ëmbëlsira dhe snacks'),('HIG','Higjienë personale'),('PAS','Pastrim shtëpie'),('LEN','Lëndë të para të furrës')) x(c, n) loop
    insert into public.product_categories (company_id, code, name) values (co, r.c, r.n);
  end loop;
  for r in select * from app.demo_catalog() loop
    v_prod := public.create_product(jsonb_build_object('company_id', co, 'code', r.code, 'name', r.name, 'uom_id', case when r.uom = 'kg' then v_kg else v_pcs end,
      'category_id', (select id from public.product_categories where company_id = co and code = r.cat),
      'sales_price', round(r.price / (1 + r.vat / 100.0), 4), 'sales_tax_code_id', app.demo_tax(co, 'VAT' || r.vat),
      'purchase_tax_code_id', app.demo_tax(co, 'VAT' || r.vat), 'is_purchasable', r.vendor <> '', 'is_manufactured', r.vendor = '',
      'standard_cost', round(r.price / (1 + r.vat / 100.0) * r.cost_pct, 4), 'generate_barcode', r.uom <> 'kg'));
  end loop;
  -- what the bakery uses
  for r in select * from (values ('MIE-FUR','Miell tip 500 për furrë','kg',0.42), ('MIE-INT','Miell integral për furrë','kg',0.58),
                                  ('MAJ-FR','Maja e freskët','kg',2.40), ('KRI-FUR','Kripë për furrë','kg',0.22)) x(c, n, u, cost) loop
    perform public.create_product(jsonb_build_object('company_id', co, 'code', r.c, 'name', r.n, 'uom_id', v_kg,
      'category_id', (select id from public.product_categories where company_id = co and code = 'LEN'), 'is_sellable', false,
      'purchase_tax_code_id', app.demo_tax(co, 'VAT8'), 'standard_cost', r.cost));
  end loop;
  -- packs: water by six, beer by 24, milk by 12
  insert into public.product_packs (company_id, product_id, name, factor, is_default)
  select co, p.id, x.n, x.f, true from (values ('UJE-15', 'Pako', 6), ('BIR-K05', 'Paketë', 24), ('QUM-28', 'Kuti', 12), ('UJE-05', 'Pako', 12)) x(c, n, f)
    join public.products p on p.company_id = co and p.code = x.c;

  -- the bakery's recipes (per loaf)
  insert into public.boms (company_id, code, variant_id, name, quantity, uom_id) values (co, 'R-BUK500', app.demo_var(co, 'BUK-500'), 'Bukë shtëpie 500 g', 1, v_pcs) returning id into v_bom;
  insert into public.bom_lines (company_id, bom_id, line_no, component_variant_id, quantity) values
    (co, v_bom, 1, app.demo_var(co, 'MIE-FUR'), 0.32), (co, v_bom, 2, app.demo_var(co, 'MAJ-FR'), 0.008), (co, v_bom, 3, app.demo_var(co, 'KRI-FUR'), 0.006);
  insert into public.boms (company_id, code, variant_id, name, quantity, uom_id) values (co, 'R-BUKINT', app.demo_var(co, 'BUK-INT'), 'Bukë integrale 400 g', 1, v_pcs) returning id into v_bom;
  insert into public.bom_lines (company_id, bom_id, line_no, component_variant_id, quantity) values
    (co, v_bom, 1, app.demo_var(co, 'MIE-INT'), 0.27), (co, v_bom, 2, app.demo_var(co, 'MAJ-FR'), 0.007), (co, v_bom, 3, app.demo_var(co, 'KRI-FUR'), 0.005);

  -- suppliers and customers
  insert into public.business_partners (company_id, code, name, kind, is_vendor, tax_number, phone, email) values
    (co, 'F01', 'Dardania Distribution L.L.C.', 'company', true, '810451227', '+383 44 210 300', 'porosi@dardania-dist.com'),
    (co, 'F02', 'Bulmetorja Fusha L.L.C.', 'company', true, '810662318', '+383 44 330 118', 'shitja@bulmetorja-fusha.com'),
    (co, 'F03', 'Agro Fresh Rahoveci', 'company', true, '811204556', '+383 49 512 774', null),
    (co, 'F04', 'Mishi i Dukagjinit Sh.p.k.', 'company', true, '810773019', '+383 44 618 220', 'zyra@mishidukagjini.com'),
    (co, 'F05', 'Euro Food Import L.L.C.', 'company', true, '810990143', '+383 38 600 900', 'orders@eurofood-ks.com'),
    (co, 'F06', 'Higjiena Plus Sh.p.k.', 'company', true, '811045672', '+383 45 220 145', null),
    (co, 'F07', 'Mulliri i Drenicës', 'company', true, '810338450', '+383 44 909 121', null),
    (co, 'S01', 'Arben Gashi (qiradhënës)', 'individual', true, null, '+383 44 101 202', null),
    (co, 'S02', 'Energjia Elektrike — fatura mujore', 'company', true, '810000101', null, null),
    (co, 'S03', 'Net & Tel Sh.p.k.', 'company', true, '810552781', null, null),
    (co, 'S04', 'Pastrimi Profesional L.L.C.', 'company', true, '811322045', null, null);
  insert into public.business_partners (company_id, code, name, kind, is_customer, tax_number, phone, email, default_discount_pct) values
    (co, 'K01', 'Restorant Te Ura', 'company', true, '811455320', '+383 44 777 120', 'teura@gmail.com', 5),
    (co, 'K02', 'Kafe Bar Sheshi', 'company', true, '811560421', '+383 49 230 554', null, 3),
    (co, 'K03', 'Çerdhja Lulet e Vogla', 'company', true, '811667032', '+383 44 120 980', 'lulet.evogla@gmail.com', 0),
    (co, 'K04', 'Hotel Kalaja', 'company', true, '810889104', '+383 38 540 600', 'furnizimi@hotelkalaja.com', 5),
    (co, 'K05', 'Shkolla Private Arsimi', 'company', true, '811990215', '+383 38 225 330', 'administrata@arsimi-ks.com', 0),
    (co, 'K00', 'Klient i rastit', 'individual', true, null, null, null, 0);
  update public.business_partners set payment_term_id = (select id from public.payment_terms where company_id = co and name = 'Net 15')
   where company_id = co and code in ('K01', 'K02', 'K04', 'F01', 'F05', 'F06');
  update public.business_partners set payment_term_id = (select id from public.payment_terms where company_id = co and name = 'Net 30')
   where company_id = co and code in ('K03', 'K05', 'F02', 'F04', 'F07');
  update public.business_partners set credit_limit = 3000 where company_id = co and code in ('K01', 'K02', 'K04');

  -- a wholesale price list for the bars and restaurants
  insert into public.price_lists (company_id, name, currency_code, prices_include_tax) values (co, 'Shumicë — HoReCa', 'EUR', false) returning id into v_pl;
  insert into public.price_list_items (company_id, price_list_id, variant_id, min_quantity, price)
  select co, v_pl, v.id, 1, round(p.sales_price * 0.9, 4) from public.product_variants v join public.products p on p.id = v.product_id
   where v.company_id = co and p.is_sellable and v.sku in ('UJE-15','UJE-05','COL-2','BIR-K05','BIR-S033','QUM-28','KAF-T200','KAF-E1','SHE-1','VAJ-1','LPO-1','ENE-025');
  update public.business_partners set price_list_id = v_pl where company_id = co and code in ('K01', 'K02', 'K04');

  -- tills
  insert into public.pos_registers (company_id, code, name, warehouse_id, location_id, cash_account_id, journal_id, default_customer_id, receipt_header, receipt_footer)
  select co, x.c, x.n, v_mkt, v_floor, v_drawer, (select id from public.journals where company_id = co and code = 'POS'), app.demo_partner(co, 'K00'),
         'Market Dardania · Rr. Agim Ramadani 45, Prishtinë · tel. 038 220 450', 'Faleminderit! Ruajeni kuponin për kthime brenda 7 ditëve.'
    from (values ('A1', 'Arka 1'), ('A2', 'Arka 2')) x(c, n);

  -- people
  for v_dep in select * from (values ('ADM','Administrata'),('ARK','Arka'),('SAL','Salla e shitjes'),('MAG','Magazina'),('FUR','Furra')) x(c, n) loop
    insert into public.departments (company_id, code, name) values (co, v_dep.c, v_dep.n);
  end loop;
  for r in select * from (values
      ('Fatmir','Krasniqi','ADM','2021-03-01',1400,'M','1012345671'), ('Vjosa','Berisha','ADM','2022-01-10',950,'F','1012345672'),
      ('Arta','Hoxha','ARK','2023-04-03',520,'F','1012345673'), ('Blerta','Gashi','ARK','2023-09-15',500,'F','1012345674'),
      ('Donika','Shala','ARK','2024-05-02',480,'F','1012345675'), ('Ilir','Morina','SAL','2022-06-01',540,'M','1012345676'),
      ('Labinot','Rexhepi','SAL','2024-02-12',480,'M','1012345677'), ('Valon','Bytyqi','MAG','2021-11-08',650,'M','1012345678'),
      ('Egzon','Kastrati','MAG','2025-03-03',500,'M','1012345679'), ('Naim','Thaçi','FUR','2022-08-22',700,'M','1012345680'),
      ('Shpresa','Kelmendi','FUR','2024-10-01',520,'F','1012345681'), ('Mimoza','Haliti','SAL','2025-07-14',460,'F','1012345682')
    ) x(fn, ln, dep, h, g, sex, nid) loop
    insert into public.employees (company_id, first_name, last_name, personal_number, gender, hire_date, department_id, phone, iban, bank_name)
    values (co, r.fn, r.ln, r.nid, case r.sex when 'M' then 'male' else 'female' end, r.h::date, (select id from public.departments where company_id = co and code = r.dep),
            '+383 44 ' || lpad((floor(random() * 999999))::text, 6, '0'), 'XK05 1212 0000 ' || lpad((floor(random() * 99999999))::text, 8, '0'), 'ProCredit Bank')
    returning id into v_emp;
    insert into public.employment_contracts (company_id, employee_id, start_date, gross_salary, currency_code, working_hours_per_week, is_primary_employer)
    values (co, v_emp, r.h::date, r.g, 'EUR', 40, true);
  end loop;

  -- loyalty cards and promotions
  perform public.loyalty_save_program(jsonb_build_object('company_id', co, 'name', 'Kartela Dardania', 'kind', 'points', 'points_per_unit', 1, 'point_value', 0.01, 'min_redeem_points', 200));
  perform public.loyalty_save_program(jsonb_build_object('company_id', co, 'name', 'Kartela VIP −5%', 'kind', 'discount', 'discount_pct', 5,
    'excluded_category_ids', jsonb_build_array((select id from public.product_categories where company_id = co and code = 'BUK'))));
  perform public.loyalty_save_program(jsonb_build_object('company_id', co, 'name', 'Stafi −10%', 'kind', 'staff', 'discount_pct', 10, 'monthly_limit', 40));
  for r in select * from (values ('Kartela Dardania','Agron Berisha','+383 44 501 101'), ('Kartela Dardania','Merita Krasniqi','+383 44 501 102'),
                                  ('Kartela Dardania','Besnik Gashi','+383 49 501 103'), ('Kartela Dardania','Teuta Shala','+383 45 501 104'),
                                  ('Kartela Dardania','Driton Hoti','+383 44 501 105'), ('Kartela Dardania','Lirie Morina','+383 44 501 106'),
                                  ('Kartela VIP −5%','Dr. Bujar Rama','+383 44 600 200'), ('Kartela VIP −5%','Hotel Kalaja (recepsioni)','+383 38 540 601'),
                                  ('Stafi −10%','Arta Hoxha','+383 44 700 301'), ('Stafi −10%','Ilir Morina','+383 44 700 302')) x(pg, holder, phone) loop
    perform public.loyalty_issue_card(jsonb_build_object('company_id', co, 'program_id', (select id from public.loyalty_programs where company_id = co and name = r.pg),
      'holder_name', r.holder, 'phone', r.phone));
  end loop;
  insert into public.promotions (company_id, name, kind, buy_qty, get_qty, channels, variant_ids, starts_on, ends_on)
  values (co, 'Ujë 1,5 L: 6 me çmimin e 5', 'buy_get', 5, 1, '{pos}', array[app.demo_var(co, 'UJE-15')], d - 20, d + 20);
  insert into public.promotions (company_id, name, kind, value, channels, category_ids, starts_on, ends_on, weekdays)
  values (co, 'Fundjava e frutave −15%', 'percent', 15, '{pos}', array[(select id from public.product_categories where company_id = co and code = 'FRU')], d - 30, d + 60, array[6, 7]);
  insert into public.promotions (company_id, name, kind, value, channels, variant_ids, starts_on, ends_on)
  values (co, 'Kafe turke 200 g vetëm 2,49 €', 'fixed_price', 2.49, '{pos,sales}', array[app.demo_var(co, 'KAF-T200')], d - 7, d + 14);
  insert into public.promotions (company_id, name, kind, value, channels, category_ids, starts_on, ends_on, time_from, time_to)
  values (co, 'Ora e lumtur e bukës −30% (pas 19:00)', 'percent', 30, '{pos}', array[(select id from public.product_categories where company_id = co and code = 'BUK')], d - 60, null, '19:00', '21:00');

  -- the money the owners put in, ninety days ago
  perform app.demo_journal(co, 'GEN', d - app.demo_days() - 25, 'KAP-001', 'Kapitali themelues i pronarëve', '[["5121", 120000, 0], ["531", 5000, 0], ["101", 0, 125000]]');
end $$;

-- ---------------------------------------------------------------------------------------------
-- step 2: purchasing — three rounds of orders, received, billed and (mostly) paid; stock to the shop
-- ---------------------------------------------------------------------------------------------
create or replace function app.demo_purchases(co uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare d date := current_date; rnd record; vnd record; v_ws numeric; v_po uuid; v_gr uuid; v_bill uuid; v_pay uuid; n int; r record; v_trf uuid; v_bank uuid;
        v_wh uuid := app.demo_wh(co, 'WH'); v_mkt uuid := app.demo_wh(co, 'MKT');
begin
  select id into v_bank from public.bank_accounts where company_id = co and account_kind = 'bank' order by created_at limit 1;
  -- rounds: days back, how many days of sales each brings, paid?
  for rnd in select b as back, case when b = app.demo_days() + 2 then 16 else 14 end as cover, b > 20 as paid
               from generate_series(app.demo_days() + 2, 4, -14) b loop
    for vnd in select distinct c.vendor from app.demo_catalog() c where c.vendor <> '' order by 1 loop
      insert into public.purchase_orders (company_id, vendor_id, warehouse_id, order_date, expected_date, currency_code)
      values (co, app.demo_partner(co, vnd.vendor), case when vnd.vendor = 'F07' then v_mkt else v_wh end, d - rnd.back, d - rnd.back + 2, 'EUR') returning id into v_po;
      n := 0;
      for r in select c.* from app.demo_catalog() c where c.vendor = vnd.vendor order by c.code loop
        n := n + 1;
        -- what the restaurants, the hotel and the school take on top of the shop
        v_ws := case when r.code in ('UJE-15','UJE-05','COL-2','BIR-S033','BIR-K05','LPO-1','VAJ-1','QUM-28','KAF-E1','SHE-1','VEZ-10','ENE-025',
                                     'KOS-1','JOG-05','MOL-KG','BAN-KG','PAT-KG','BIS-300') then 0.6 else 0 end;
        insert into public.purchase_order_lines (company_id, purchase_order_id, line_no, variant_id, description, quantity, unit_price, tax_code_id)
        values (co, v_po, n, app.demo_var(co, r.code), r.name,
                case when r.uom = 'kg' then round(r.per_day * rnd.cover * (1.25 * app.demo_k(r.code) + v_ws) * (0.95 + random()::numeric * 0.15), 1)
                     else ceil(r.per_day * rnd.cover * (1.25 * app.demo_k(r.code) + v_ws) * (0.95 + random()::numeric * 0.15) / 6) * 6 end,
                round(r.price / (1 + r.vat / 100.0) * r.cost_pct * (0.98 + random()::numeric * 0.05), 4), app.demo_tax(co, 'VAT' || r.vat));
      end loop;
      if vnd.vendor = 'F07' then   -- the mill also brings the bakery's flour, yeast and salt
        insert into public.purchase_order_lines (company_id, purchase_order_id, line_no, variant_id, description, quantity, unit_price, tax_code_id) values
          (co, v_po, n + 1, app.demo_var(co, 'MIE-FUR'), 'Miell tip 500 për furrë (thasë 25 kg)', 25 * ceil(70 * 1.7 * rnd.cover * 0.32 / 25), 0.42, app.demo_tax(co, 'VAT8')),
          (co, v_po, n + 2, app.demo_var(co, 'MIE-INT'), 'Miell integral për furrë (thasë 25 kg)', 25 * ceil(18 * 1.7 * rnd.cover * 0.27 / 25), 0.58, app.demo_tax(co, 'VAT8')),
          (co, v_po, n + 3, app.demo_var(co, 'MAJ-FR'), 'Maja e freskët', ceil(150 * rnd.cover * 0.008), 2.40, app.demo_tax(co, 'VAT8')),
          (co, v_po, n + 4, app.demo_var(co, 'KRI-FUR'), 'Kripë për furrë', ceil(150 * rnd.cover * 0.006), 0.22, app.demo_tax(co, 'VAT8'));
      end if;
      perform public.submit_purchase_order(v_po);
      if rnd.back < 18 and vnd.vendor = 'F06' then continue; end if;   -- the last cleaning-goods order is still on the way
      v_gr := public.create_receipt_from_po(v_po);
      update public.goods_receipts set receipt_date = d - rnd.back + 2, vendor_delivery_note = 'FL-' || vnd.vendor || '-' || to_char(d - rnd.back + 2, 'MMDD') where id = v_gr;
      -- straight to the shelves: chilled goods to the cold room, the rest to the main stock
      update public.goods_receipt_lines gl set location_id = case when c.cat in ('BUL', 'MIS') then app.demo_loc(co, 'WH/FRIGO') else app.demo_loc(co, 'WH/STOCK') end
        from public.product_variants v left join app.demo_catalog() c on c.code = v.sku
       where gl.receipt_id = v_gr and v.id = gl.variant_id and vnd.vendor <> 'F07';
      perform public.post_goods_receipt(v_gr);
      v_bill := public.create_bill_from_po(v_po, vnd.vendor || '-' || to_char(d - rnd.back + 2, 'YYYY') || '-' || lpad((floor(random() * 9000) + 1000)::text, 4, '0'), d - rnd.back + 2);
      update public.vendor_bills set due_date = d - rnd.back + 2 + 20 where id = v_bill;
      perform public.post_vendor_bill(v_bill, 'Demo');
      if rnd.paid and not (rnd.back between 21 and 34 and vnd.vendor in ('F02', 'F04')) then
        insert into public.payments (company_id, document_type, partner_id, method, amount, bank_account_id, payment_date, reference)
        select co, 'vendor_payment', vendor_id, 'bank_transfer', total, v_bank, least(d - rnd.back + 16, d - 1), 'Pagesë ' || vendor_invoice_number
          from public.vendor_bills where id = v_bill returning id into v_pay;
        insert into public.payment_allocations (company_id, payment_id, vendor_bill_id, amount) select co, v_pay, v_bill, total from public.vendor_bills where id = v_bill;
        perform public.post_payment(v_pay);
      end if;
    end loop;
    -- the shop takes its share from the warehouse the next day
    insert into public.stock_transfers (company_id, from_warehouse_id, to_warehouse_id, transfer_date) values (co, v_wh, v_mkt, d - rnd.back + 3) returning id into v_trf;
    insert into public.stock_transfer_lines (company_id, transfer_id, variant_id, from_location_id, to_location_id, quantity)
    select co, v_trf, sl.variant_id, sl.location_id, app.demo_loc(co, 'MKT/SALLA'),
           least(sl.on_hand, case when c.uom = 'kg' then round(c.per_day * rnd.cover * 1.25 * app.demo_k(c.code), 1) else ceil(c.per_day * rnd.cover * 1.25 * app.demo_k(c.code)) end)
      from public.stock_levels sl join public.product_variants v on v.id = sl.variant_id join app.demo_catalog() c on c.code = v.sku
     where sl.company_id = co and sl.location_id in (app.demo_loc(co, 'WH/STOCK'), app.demo_loc(co, 'WH/FRIGO')) and sl.on_hand >= 1;
    if exists (select 1 from public.stock_transfer_lines where transfer_id = v_trf) then perform public.post_stock_transfer(v_trf); else delete from public.stock_transfers where id = v_trf; end if;
  end loop;
  -- a draft order for next week
  insert into public.purchase_orders (company_id, vendor_id, warehouse_id, order_date, expected_date, currency_code, notes)
  values (co, app.demo_partner(co, 'F01'), v_wh, d, d + 4, 'EUR', 'Porosi për fundjavën e gjatë — të konfirmohet me Valonin') returning id into v_po;
  insert into public.purchase_order_lines (company_id, purchase_order_id, line_no, variant_id, description, quantity, unit_price, tax_code_id)
  select co, v_po, row_number() over (order by c.code), app.demo_var(co, c.code), c.name, ceil(c.per_day * 10 / 6) * 6, round(c.price / (1 + c.vat / 100.0) * c.cost_pct, 4), app.demo_tax(co, 'VAT' || c.vat)
    from app.demo_catalog() c where c.vendor = 'F01';
end $$;

-- ---------------------------------------------------------------------------------------------
-- steps 3–6: the tills, day by day
-- ---------------------------------------------------------------------------------------------
create or replace function app.demo_till_day(co uuid, p_reg uuid, p_day date, p_n int, p_close boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ses uuid; i int; k int; lines jsonb; total numeric; it record; q numeric; v_at timestamptz; v_cash numeric; paid numeric; v_tz text := 'Europe/Belgrade';
        cat jsonb; pb jsonb; v_wh uuid; v_span numeric; v_w numeric; v_r numeric;
begin
  -- what this till sells and at which price (the catalogue as the till sees it)
  select jsonb_agg(jsonb_build_object('v', y.variant_id, 'p', y.price, 'n', y.name, 'kg', y.uom = 'kg', 'sku', y.code, 'cat', y.cat, 'c', y.cum) order by y.code), max(y.cum)
    into cat, v_w
    from (select x.variant_id, x.price, x.name, c.uom, c.code, c.cat, sum(c.per_day) over (order by c.code) as cum
            from public.pos_catalog(p_reg) x join app.demo_catalog() c on c.code = x.sku) y;
  select warehouse_id into v_wh from public.pos_registers where id = p_reg;
  -- a full day runs to 21:00; today only up to now
  v_span := case when p_day = (now() at time zone v_tz)::date
                 then greatest(extract(epoch from (now() - ((p_day + time '07:15') at time zone v_tz))) / 60 - 15, 30) else 825 end;
  perform set_config('app.demo_clock', ((p_day + time '07:00') at time zone v_tz)::text, true);
  v_ses := public.open_pos_session(p_reg, 50);
  update public.pos_sessions set opened_at = (p_day + time '07:00') at time zone v_tz where id = v_ses;
  for i in 1 .. p_n loop
    lines := '[]'::jsonb; total := 0;
    v_at := ((p_day + time '07:15') at time zone v_tz) + ((i - 1) * (v_span / p_n) + random() * 8) * interval '1 minute';
    -- a basket: 1 to 9 things, the everyday ones more often
    for k in 1 .. 1 + floor(power(random(), 1.2) * 16)::int loop
      -- the things people buy every day come up more often: picked in proportion to what sells
      v_r := random() * v_w;
      select e into it from jsonb_array_elements(cat) e where (e ->> 'c')::numeric >= v_r order by (e ->> 'c')::numeric limit 1;
      q := case when (it.e ->> 'kg')::boolean then round((0.3 + random() * 1.4)::numeric, 3) else 1 + floor(power(random(), 3) * 3) end;
      if it.e ->> 'sku' = 'UJE-15' and random() < 0.2 then q := 6; end if;   -- a six-pack of water, six for the price of five
      -- the till applies the best promotion running at that moment, as it does at the counter
      pb := app.promo_best(co, v_wh, (it.e ->> 'v')::uuid, q, (it.e ->> 'p')::numeric, v_at, 'pos');
      lines := lines || jsonb_build_object('variant_id', it.e ->> 'v', 'quantity', q, 'unit_price', (it.e ->> 'p')::numeric,
                 'discount_pct', coalesce((pb ->> 'pct')::numeric, 0), 'promotion_id', pb ->> 'id', 'description', it.e ->> 'n');
      total := total + round(q * (it.e ->> 'p')::numeric * (1 - coalesce((pb ->> 'pct')::numeric, 0) / 100), 2);
    end loop;
    v_cash := case when random() < 0.62 then 1 else 0 end;
    paid := case when v_cash = 1 then case when total < 5 then ceil(total) when total < 20 then ceil(total / 5) * 5 else ceil(total / 10) * 10 end else total end;
    perform public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', v_ses, 'order_at', v_at, 'lines', lines,
      'payments', jsonb_build_array(jsonb_build_object('method', case when v_cash = 1 then 'cash' else 'card' end, 'amount', paid))));
  end loop;
  if p_close then
    perform set_config('app.demo_clock', ((p_day + time '21:10') at time zone v_tz)::text, true);
    perform public.close_pos_session(v_ses, (public.pos_session_summary(v_ses) ->> 'expected_cash')::numeric
      - case when random() < 0.12 then round((random() * 4)::numeric, 1) else 0 end,
      null);
  end if;
  perform set_config('app.demo_clock', '', true);
end $$;

create or replace function app.demo_tills(co uuid, p_back int, p_reg text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_day date := current_date - p_back; wd int := extract(isodow from current_date - p_back); n int;
begin
  perform set_config('app.pos_allow_negative', 'on', true);
  -- a normal week: Saturday is the busiest day, Sunday the quietest; the second till opens for the rush
  n := case when wd = 6 then 70 when wd = 7 then 44 when wd = 5 then 62 else 54 end;
  -- the first weeks are quieter; people find the new shop
  if p_back > 30 then n := round(n * (0.6 + 0.4 * (app.demo_days() - p_back) / greatest(app.demo_days() - 30, 1))); end if;
  if p_reg = 'A2' then n := greatest(n - 14, 20); end if;
  perform app.demo_till_day(co, (select id from public.pos_registers where company_id = co and code = p_reg), v_day, n);
end $$;

-- ---------------------------------------------------------------------------------------------
-- step 7: the bakery — a batch every few days
-- ---------------------------------------------------------------------------------------------
create or replace function app.demo_bakery(co uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare b int; v_wo uuid; v_mkt uuid := app.demo_wh(co, 'MKT'); v_floor uuid := app.demo_loc(co, 'MKT/SALLA'); r record;
begin
  for b in reverse app.demo_days() / 3 + 1 .. 1 loop
    for r in select * from (values ('R-BUK500', 340), ('R-BUKINT', 90)) x(bom, q) loop
      v_wo := public.create_work_order(jsonb_build_object('bom_id', (select id from public.boms where company_id = co and code = r.bom), 'quantity', r.q,
                'warehouse_id', v_mkt, 'component_location_id', v_floor, 'output_location_id', v_floor,
                'planned_start', ((current_date - b * 3) + time '04:00')::text, 'notes', 'Furra e marketit, turni i mëngjesit'));
      perform public.release_work_order(v_wo);
      perform public.produce(v_wo, r.q, 'F' || to_char(current_date - b * 3, 'YYMMDD') || '-' || right(r.bom, 3), current_date - b * 3 + 3);
      perform public.close_work_order(v_wo);
    end loop;
  end loop;
  -- tomorrow's batch is planned
  perform public.create_work_order(jsonb_build_object('bom_id', (select id from public.boms where company_id = co and code = 'R-BUK500'), 'quantity', 340,
            'warehouse_id', v_mkt, 'component_location_id', v_floor, 'output_location_id', v_floor, 'planned_start', ((current_date + 1) + time '04:00')::text));
end $$;

-- ---------------------------------------------------------------------------------------------
-- step 8: wholesale customers — quotes, orders, deliveries, invoices, payments
-- ---------------------------------------------------------------------------------------------
create or replace function app.demo_wholesale(co uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare d date := current_date; r record; v_so uuid; v_dl uuid; v_inv uuid; v_pay uuid; v_q uuid; v_bank uuid; n int; it record; v_cn uuid;
begin
  select id into v_bank from public.bank_accounts where company_id = co and account_kind = 'bank' order by created_at limit 1;
  for r in select * from (values
      ('K01', 55, 'UJE-15:120,COL-2:48,BIR-S033:96,LPO-1:24,VAJ-1:12', true), ('K04', 52, 'UJE-05:240,UJE-15:96,QUM-28:72,KAF-E1:6,SHE-1:24,VEZ-10:30', true),
      ('K02', 45, 'UJE-05:192,COL-2:24,ENE-025:48,BIR-K05:96,KAF-E1:4', true), ('K03', 40, 'QUM-28:96,KOS-1:40,JOG-05:60,MOL-KG:60,BAN-KG:40', true),
      ('K01', 33, 'UJE-15:96,COL-2:36,BIR-S033:72,VAJ-1:12,PAT-KG:80', true), ('K05', 30, 'UJE-05:300,BIS-300:60,MOL-KG:80,QUM-28:60', true),
      ('K04', 24, 'UJE-05:240,UJE-15:72,QUM-28:60,KAF-E1:6,LPO-1:24', true), ('K02', 18, 'UJE-05:144,BIR-K05:120,ENE-025:48', false),
      ('K03', 12, 'QUM-28:96,KOS-1:40,JOG-05:60,BAN-KG:40', false), ('K01', 8, 'UJE-15:120,COL-2:48,BIR-S033:96', false),
      ('K04', 4, 'UJE-05:240,QUM-28:72,VEZ-10:30,SHE-1:24', false)
    ) x(cust, back, items, paid) loop
    r.back := greatest(round(r.back * app.demo_days() / 58.0)::int, 2);
    insert into public.sales_orders (company_id, partner_id, warehouse_id, order_date, requested_date, currency_code, price_list_id, customer_reference)
    select co, id, app.demo_wh(co, 'WH'), d - r.back, d - r.back + 1, 'EUR', price_list_id, 'Porosi me telefon' from public.business_partners where id = app.demo_partner(co, r.cust)
    returning id into v_so;
    n := 0;
    for it in select split_part(x, ':', 1) as sku, split_part(x, ':', 2)::numeric as q from unnest(string_to_array(r.items, ',')) x loop
      n := n + 1;
      insert into public.sales_order_lines (company_id, sales_order_id, line_no, variant_id, description, quantity, unit_price, tax_code_id, discount_pct)
      select co, v_so, n, v.id, p.name, it.q, coalesce(gp.unit_price, p.sales_price), p.sales_tax_code_id, coalesce(gp.discount_pct, 0)
        from public.product_variants v join public.products p on p.id = v.product_id
        left join lateral public.get_price(co, app.demo_partner(co, r.cust), v.id, it.q, d - r.back, null) gp on true
       where v.id = app.demo_var(co, it.sku);
    end loop;
    perform public.confirm_sales_order(v_so);
    v_dl := public.create_delivery_from_order(v_so);
    perform set_config('app.demo_clock', ((d - r.back + 1) + time '09:30')::text, true);
    perform public.post_delivery(v_dl);
    perform set_config('app.demo_clock', '', true);
    v_inv := public.create_invoice_from_order(v_so);
    update public.sales_invoices set invoice_date = d - r.back + 1, due_date = d - r.back + 16 where id = v_inv;
    perform public.post_sales_invoice(v_inv);
    if r.paid then
      insert into public.payments (company_id, document_type, partner_id, method, amount, bank_account_id, payment_date, reference)
      select co, 'customer_payment', partner_id, 'bank_transfer', total, v_bank, least(d - r.back + 12 + floor(random() * 8)::int, d - 1), 'Pagesë për ' || number
        from public.sales_invoices where id = v_inv returning id into v_pay;
      insert into public.payment_allocations (company_id, payment_id, sales_invoice_id, amount) select co, v_pay, v_inv, total from public.sales_invoices where id = v_inv;
      perform public.post_payment(v_pay);
    end if;
  end loop;
  -- Restaurant Te Ura sent back 12 bottles that came broken
  select id into v_inv from public.sales_invoices where company_id = co and partner_id = app.demo_partner(co, 'K01') and status = 'posted' order by invoice_date desc limit 1;
  v_cn := public.create_credit_note(v_inv);
  delete from public.sales_invoice_lines where invoice_id = v_cn and variant_id <> app.demo_var(co, 'BIR-S033');
  update public.sales_invoice_lines set quantity = 12 where invoice_id = v_cn;
  update public.sales_invoices set notes = '12 shishe të thyera gjatë transportit' where id = v_cn;
  perform public.post_sales_invoice(v_cn);
  -- a confirmed order waiting for the warehouse, and a quote for a new customer
  insert into public.sales_orders (company_id, partner_id, warehouse_id, order_date, requested_date, currency_code, price_list_id)
  select co, id, app.demo_wh(co, 'WH'), d, d + 1, 'EUR', price_list_id from public.business_partners where id = app.demo_partner(co, 'K02') returning id into v_so;
  insert into public.sales_order_lines (company_id, sales_order_id, line_no, variant_id, description, quantity, unit_price, tax_code_id)
  select co, v_so, row_number() over (), v.id, p.name, x.q, p.sales_price * 0.9, p.sales_tax_code_id
    from (values ('UJE-05', 144), ('COL-2', 24), ('BIR-K05', 96)) x(sku, q) join public.product_variants v on v.id = app.demo_var(co, x.sku) join public.products p on p.id = v.product_id;
  perform public.confirm_sales_order(v_so);
  insert into public.sales_quotes (company_id, partner_id, quote_date, valid_until, currency_code, notes)
  values (co, app.demo_partner(co, 'K05'), d - 2, d + 12, 'EUR', 'Furnizim javor për mensën e shkollës, shtator–qershor') returning id into v_q;
  insert into public.sales_quote_lines (company_id, quote_id, line_no, variant_id, description, quantity, unit_price, tax_code_id)
  select co, v_q, row_number() over (), v.id, p.name, x.q, round(p.sales_price * 0.92, 4), p.sales_tax_code_id
    from (values ('QUM-28', 120), ('BUK-500', 300), ('MOL-KG', 100), ('JOG-05', 150), ('UJE-05', 400)) x(sku, q)
    join public.product_variants v on v.id = app.demo_var(co, x.sku) join public.products p on p.id = v.product_id;
end $$;

-- ---------------------------------------------------------------------------------------------
-- step 9: running costs, assets, cash to the bank
-- ---------------------------------------------------------------------------------------------
create or replace function app.demo_finance(co uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare d date := current_date; m int; r record; v_bill uuid; v_pay uuid; v_bank uuid; v_cash uuid; v_fa uuid; v_month date; v_amt numeric;
begin
  select id into v_bank from public.bank_accounts where company_id = co and account_kind = 'bank' order by created_at limit 1;
  for m in 0 .. 1 loop
    v_month := (date_trunc('month', d) - (m || ' months')::interval)::date;
    for r in select * from (values ('S01', 'Qiraja e lokalit', 2200.00, 'EXEMPT', '612', 1), ('S02', 'Energjia elektrike', 610 + random() * 140, 'VAT8', '614', 8),
                                    ('S03', 'Internet dhe telefon', 49.00, 'VAT18', '614', 10), ('S04', 'Pastrimi i lokalit', 380.00, 'VAT18', '602', 25)) x(vnd, descr, amt, tax, acc, day) loop
      if v_month + r.day - 1 > d then continue; end if;
      insert into public.vendor_bills (company_id, vendor_id, vendor_invoice_number, bill_date, due_date, currency_code)
      values (co, app.demo_partner(co, r.vnd), r.vnd || '-' || to_char(v_month, 'YYYYMM'), v_month + r.day - 1, v_month + r.day + 14, 'EUR') returning id into v_bill;
      insert into public.vendor_bill_lines (company_id, bill_id, line_no, description, account_id, quantity, unit_price, tax_code_id)
      values (co, v_bill, 1, r.descr || ', ' || to_char(v_month, 'MM/YYYY'), app.demo_acc(co, r.acc), 1, round(r.amt::numeric, 2), app.demo_tax(co, r.tax));
      perform public.post_vendor_bill(v_bill);
      if v_month + r.day + 5 < d then
        insert into public.payments (company_id, document_type, partner_id, method, amount, bank_account_id, payment_date, reference)
        select co, 'vendor_payment', vendor_id, 'bank_transfer', total, v_bank, v_month + r.day + 5, vendor_invoice_number from public.vendor_bills where id = v_bill returning id into v_pay;
        insert into public.payment_allocations (company_id, payment_id, vendor_bill_id, amount) select co, v_pay, v_bill, total from public.vendor_bills where id = v_bill;
        perform public.post_payment(v_pay);
      end if;
    end loop;
  end loop;
  -- what the shop was fitted with
  for r in select * from (values ('Frigoriferë vertikalë për bulmet (3 copë)', 'Equipment and machinery', 6900, 84, 'Salla, muri i djathtë'),
                                  ('Vitrinë frigoriferike për mish', 'Equipment and machinery', 4200, 84, 'Salla, këndi i mishit'),
                                  ('Furra elektrike me 5 nivele', 'Equipment and machinery', 8500, 96, 'Furra'),
                                  ('Raftet metalike të sallës', 'Furniture and IT equipment', 5600, 120, 'Salla e shitjes'),
                                  ('Dy arka me peshore dhe skaner', 'Furniture and IT equipment', 3400, 48, 'Arkat 1 dhe 2'),
                                  ('Furgon frigoriferik', 'Vehicles', 24500, 60, 'Oborri i magazinës')) x(n, cat, cost, life, loc) loop
    insert into public.fixed_assets (company_id, name, category_id, acquisition_date, in_service_date, acquisition_cost, useful_life_months, location_note)
    select co, r.n, id, d - app.demo_days() - 12, d - app.demo_days() - 2, r.cost, r.life, r.loc from public.fixed_asset_categories where company_id = co and name = r.cat returning id into v_fa;
    perform public.activate_fixed_asset(v_fa, app.demo_acc(co, '5121'));
  end loop;
  perform public.run_depreciation(co, (date_trunc('month', d) - interval '1 day')::date);
  insert into public.vehicles (company_id, plate_number, name, vehicle_type, capacity_kg, fixed_asset_id)
  select co, '01-456-KS', 'Furgon frigoriferik', 'van', 1200, id from public.fixed_assets where company_id = co and name = 'Furgon frigoriferik';
  -- the drawers' cash goes to the bank every few days
  select id into v_cash from public.bank_accounts where company_id = co and account_kind = 'cash' and account_id = app.demo_acc(co, '531');
  for m in reverse app.demo_days() - 1 .. 1 loop
    if m % 3 <> 0 then continue; end if;
    select round(sum(pp.amount) * 0.9, -1) into v_amt from public.pos_payments pp join public.pos_orders o on o.id = pp.pos_order_id
     where o.company_id = co and pp.method = 'cash' and (o.order_at at time zone 'Europe/Belgrade')::date between d - m - 3 and d - m - 1;
    if coalesce(v_amt, 0) > 0 then
      perform app.demo_journal(co, 'CSH', d - m, 'DEP-' || to_char(d - m, 'MMDD'), 'Derdhje e parave të arkave në ProCredit Bank',
        jsonb_build_array(jsonb_build_array('5121', v_amt, 0), jsonb_build_array('531', 0, v_amt)));
    end if;
  end loop;
  -- the card terminal pays out the next working day, less 1.2 % commission
  for m in reverse app.demo_days() .. 1 loop
    select round(sum(pp.amount), 2) into v_amt from public.pos_payments pp join public.pos_orders o on o.id = pp.pos_order_id
     where o.company_id = co and pp.method = 'card' and (o.order_at at time zone 'Europe/Belgrade')::date = d - m - 1;
    if coalesce(v_amt, 0) > 0 then
      perform app.demo_journal(co, 'BNK', d - m, 'POS-' || to_char(d - m - 1, 'MMDD'), 'Kartelat e arkave, ' || to_char(d - m - 1, 'DD.MM') || ' (pa komisionin e bankës)',
        jsonb_build_array(jsonb_build_array('5121', v_amt - round(v_amt * 0.012, 2), 0), jsonb_build_array('662', round(v_amt * 0.012, 2), 0), jsonb_build_array('581', 0, v_amt)));
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- step 10: people — attendance, two months of payroll; CRM; VAT
-- ---------------------------------------------------------------------------------------------
create or replace function app.demo_people(co uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare d date := current_date; e record; v_day date; v_run uuid; r_c numeric; r_t numeric; m int; v_month date; v_lead uuid; v_vd uuid; v_start time;
begin
  -- this month's clock-ins (the tills open early, the bakery earlier)
  for e in select em.id, dp.code as dep from public.employees em left join public.departments dp on dp.id = em.department_id where em.company_id = co loop
    for v_day in select generate_series(date_trunc('month', d)::date, d - 1, '1 day')::date loop
      if extract(isodow from v_day) = 7 and e.dep in ('ADM', 'MAG') then continue; end if;
      if random() < 0.14 then continue; end if;   -- days off by the rota
      v_start := case e.dep when 'FUR' then time '04:00' when 'ARK' then case when random() < 0.5 then time '07:00' else time '14:00' end
                            when 'SAL' then time '07:30' else time '08:00' end;
      insert into public.attendance_records (company_id, employee_id, work_date, check_in, check_out, source)
      values (co, e.id, v_day, (v_day + v_start + (random() * 10) * interval '1 minute') at time zone 'Europe/Belgrade',
              (v_day + v_start + interval '8 hours' + (random() * 25) * interval '1 minute') at time zone 'Europe/Belgrade', 'manual');
    end loop;
  end loop;
  -- the last two months' salaries, calculated, approved and paid out
  for m in reverse 1 .. 1 loop
    v_month := (date_trunc('month', d) - (m || ' months')::interval)::date;
    v_run := public.create_payroll_run(co, extract(year from v_month)::int, extract(month from v_month)::int, (v_month + interval '1 month' + interval '4 days')::date);
    perform public.calculate_payroll(v_run);
    update public.payroll_runs set calculated_by = null where id = v_run;   -- the accountant calculated it, the owner approves
    perform public.approve_payroll(v_run);
    perform public.post_payroll(v_run);
    select coalesce(sum(employee_contributions + employer_contributions), 0), coalesce(sum(income_tax), 0) into r_c, r_t from public.payslips where payroll_run_id = v_run;
    perform public.pay_payroll(v_run, (select id from public.bank_accounts where company_id = co and account_kind = 'bank' order by created_at limit 1),
                               least((v_month + interval '1 month' + interval '4 days')::date, d - 1));
    if (v_month + interval '1 month' + interval '14 days')::date < d then
      perform app.demo_journal(co, 'BNK', (v_month + interval '1 month' + interval '14 days')::date, 'ATK-' || to_char(v_month, 'YYYYMM'),
        'Kontributet pensionale dhe tatimi në paga, ' || to_char(v_month, 'MM/YYYY'),
        jsonb_build_array(jsonb_build_array('431', r_c, 0), jsonb_build_array('442', r_t, 0), jsonb_build_array('5121', 0, r_c + r_t)));
    end if;
  end loop;
  -- a salary advance being paid back
  insert into public.employee_deductions (company_id, employee_id, kind, name, amount, total, starts_on)
  select co, id, 'advance', 'Paradhënie rroge', 100, 300, date_trunc('month', d)::date from public.employees where company_id = co and first_name = 'Egzon';

  -- CRM: businesses that may buy wholesale
  for e in select * from (values ('Furnizim për restorantin e ri në Arbëri', 'Gëzim Rama', 'Restorant Oda', 'gezim@odarestaurant.com', 'referral', 1800, 'qualified'),
                                  ('Pije për dasmat e sezonit', 'Liridona Bekteshi', 'Salla e Ahengjeve Elita', null, 'cold_call', 4500, 'new'),
                                  ('Bukë dhe bulmet për çerdhen e dytë', 'Sabina Ademi', 'Çerdhja Fluturat', 'fluturat@gmail.com', 'website', 1200, 'contacted'),
                                  ('Kafe dhe ujë për zyrat', 'Arianit Leka', 'Kosova IT Hub', 'office@kosovaithub.com', 'campaign', 900, 'new')) x(t, c, cn, em, src, val, st) loop
    insert into public.leads (company_id, title, contact_name, company_name, email, source, estimated_value, currency_code)
    values (co, e.t, e.c, e.cn, e.em, e.src, e.val, 'EUR') returning id into v_lead;
    if e.st <> 'new' then update public.leads set status = e.st where id = v_lead; end if;
  end loop;
  insert into public.opportunities (company_id, name, partner_id, stage_id, expected_value, currency_code, expected_close_date)
  select co, 'Mensa e shkollës — furnizim vjetor', app.demo_partner(co, 'K05'), id, 14000, 'EUR', d + 20 from public.crm_pipeline_stages where company_id = co and name = 'Proposal';
  insert into public.opportunities (company_id, name, partner_id, stage_id, expected_value, currency_code, expected_close_date)
  select co, 'Hotel Kalaja — mëngjeset e dimrit', app.demo_partner(co, 'K04'), id, 6500, 'EUR', d + 35 from public.crm_pipeline_stages where company_id = co and name = 'Negotiation';

  -- last month's VAT return
  v_month := (date_trunc('month', d) - interval '1 month')::date;
  v_vd := public.create_vat_declaration(co, extract(year from v_month)::int, extract(month from v_month)::int);
end $$;

-- the tills are open today, with the morning's sales
create or replace function app.demo_today(co uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ses uuid; n int;
begin
  perform set_config('app.pos_allow_negative', 'on', true);
  n := greatest(least(floor(extract(epoch from ((now() at time zone 'Europe/Belgrade')::time - time '07:15')) / 60 / 30)::int, 26), 3);
  perform app.demo_till_day(co, (select id from public.pos_registers where company_id = co and code = 'A1'), current_date, n, false);
end $$;

-- ---------------------------------------------------------------------------------------------
-- the platform's two calls
-- ---------------------------------------------------------------------------------------------
create or replace function public.platform_create_demo_client(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_co uuid; v_owner uuid;
begin
  perform app.require_super_admin();
  v_co := public.platform_create_client(jsonb_build_object('name', coalesce(nullif(btrim(p ->> 'name'), ''), 'Market Dardania (demo)'), 'country', 'XK',
            'owner_email', p ->> 'owner_email', 'owner_password', p ->> 'owner_password', 'owner_name', coalesce(nullif(p ->> 'owner_name', ''), 'Fatmir Krasniqi'),
            'plan', 'pro', 'max_users', 10, 'valid_until', (current_date + coalesce((p ->> 'days')::int, 30))::text,
            'business_type', 'general', 'notes', 'Klient demo: supermarket në Kosovë me të dhëna shembull'));
  select user_id into v_owner from public.company_members where company_id = v_co and status = 'active' order by created_at limit 1;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform app.demo_base(v_co);
  -- the owner stays the acting user to the end of the call: postings made at commit carry their name
  return jsonb_build_object('company_id', v_co, 'next', 2, 'steps', 3 + 2 * app.demo_days() + 4);
end $$;

create or replace function public.platform_demo_fill(p_company uuid, p_step int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_last int := 3 + 2 * app.demo_days(); v_steps int := 3 + 2 * app.demo_days() + 4;
begin
  perform app.require_super_admin();
  if not exists (select 1 from public.licenses where company_id = p_company and notes like 'Klient demo%') then
    raise exception 'Only a demo client is filled with sample data' using errcode = '42501';
  end if;
  select user_id into v_owner from public.company_members where company_id = p_company and status = 'active' order by created_at limit 1;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  case
    when p_step = 2 then perform app.demo_purchases(p_company);
    when p_step = 3 then perform app.demo_bakery(p_company);
    -- the tills, one till and one day a call, from the opening day to yesterday (Arka 1 then Arka 2)
    when p_step between 4 and v_last then perform app.demo_tills(p_company, app.demo_days() - (p_step - 4) / 2, case when p_step % 2 = 0 then 'A1' else 'A2' end);
    when p_step = v_last + 1 then perform app.demo_wholesale(p_company);
    when p_step = v_last + 2 then perform app.demo_finance(p_company);
    when p_step = v_last + 3 then perform app.demo_people(p_company);
    when p_step = v_last + 4 then perform app.demo_today(p_company);
    else raise exception 'No such step' using errcode = '22023';
  end case;
  -- the owner stays the acting user to the end of the call: postings made at commit carry their name
  return jsonb_build_object('next', case when p_step < v_steps then p_step + 1 end, 'steps', v_steps);
end $$;

revoke execute on function public.platform_create_demo_client(jsonb), public.platform_demo_fill(uuid, int) from public, anon;
grant execute on function public.platform_create_demo_client(jsonb), public.platform_demo_fill(uuid, int) to authenticated;
revoke execute on function app.demo_base(uuid), app.demo_purchases(uuid), app.demo_till_day(uuid, uuid, date, int, boolean), app.demo_tills(uuid, int, text),
  app.demo_bakery(uuid), app.demo_wholesale(uuid), app.demo_finance(uuid), app.demo_people(uuid), app.demo_today(uuid) from public;

drop function app._patch_function(text, text, text);
