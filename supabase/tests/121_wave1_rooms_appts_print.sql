-- =============================================================================
-- Wave 1 of the audit, part 3: goods charged to a room leave the stock, an appointment is paid at
-- the till, and transfers and adjustments are printed. (after 31 and 38)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);

-- 1. a minibar drink picked from the items leaves the stock at check-out, with its cost booked
select t.company_id as hco from public.hotel_room_types t where t.name = 'Dyshe' limit 1 \gset
select r.id as r102 from public.hotel_rooms r where r.company_id = :'hco' and r.number = '102' \gset
select coalesce((select default_warehouse_id from public.company_settings where company_id = :'hco'),
                (select id from public.warehouses where company_id = :'hco' and deleted_at is null and is_active order by created_at limit 1)) as hwh \gset
select v.id as drink from public.product_variants v join public.products p on p.id = v.product_id
 where p.company_id = :'hco' and p.product_type = 'stockable' and p.deleted_at is null and coalesce(p.tracking, 'none') = 'none' order by v.created_at limit 1 \gset
-- five on the shelf of the hotel's unit
select app.post_stock_move(:'hco', 'receipt', :'drink', app.virtual_location(:'hco', 'supplier'), app.main_location(:'hwh'), 5, 1.5);
select coalesce(sum(on_hand), 0) as had from public.stock_levels where variant_id = :'drink' and location_id = app.main_location(:'hwh') \gset
set role authenticated;
select t.login('alice@alba.al');
insert into public.hotel_reservations (company_id, room_id, guest_name, check_in, check_out, rate)
values (:'hco', :'r102', 'Mysafir Minibari', current_date - 1, current_date + 1, 5000) returning id as res \gset
select public.hotel_check_in(:'res');
insert into public.hotel_charges (company_id, reservation_id, description, variant_id, quantity, unit_price) values (:'hco', :'res', 'Ujë', :'drink', 2, 120);
insert into public.hotel_charges (company_id, reservation_id, description, quantity, unit_price) values (:'hco', :'res', 'Larje rrobash', 1, 500);
select public.hotel_check_out(:'res') as inv \gset
reset role;
select t.ok((select sum(quantity) from public.stock_movements where source_doc_type = 'sales_invoice' and source_doc_id = :'inv' and variant_id = :'drink') = 2,
            'the two drinks left the stock with the check-out invoice');
select t.ok((select sum(on_hand) from public.stock_levels where company_id = :'hco' and variant_id = :'drink'
               and location_id = app.main_location(:'hwh')) = :'had'::numeric - 2,
            'the shelf has two fewer');
select t.ok((select count(*) from public.stock_movements where source_doc_type = 'sales_invoice' and source_doc_id = :'inv') = 1, 'the laundry, a service, moves nothing');
select t.ok(exists (select 1 from public.stock_movements where source_doc_id = :'inv' and journal_entry_id is not null), 'and the cost of the drinks is booked');

-- 2. an appointment paid at the till
select id as salon from public.companies where name = 'Sallon Test' \gset
select r.id as res2 from public.appt_resources r where r.company_id = :'salon' order by r.created_at limit 1 \gset
select s.id as cut from public.appt_services s where s.company_id = :'salon' and s.name = 'Prerje flokësh' \gset
set role authenticated;
select t.login('alice@alba.al');
select public.appt_save(jsonb_build_object('company_id', :'salon', 'resource_id', :'res2', 'service_id', :'cut',
  'starts_at', ((current_date + 3 + time '15:00')::timestamp at time zone 'Europe/Tirane'), 'client_name', 'Klientja e Arkës', 'client_phone', '044999888')) as a \gset
select public.appt_for_till(:'a') as tl \gset
select t.ok((:'tl'::jsonb ->> 'variant_id') is not null and (:'tl'::jsonb ->> 'price')::numeric = 15 and (:'tl'::jsonb ->> 'partner_id') is not null,
            'the till gets the service, its price with VAT and the client');
select public.appt_paid_at_till(:'a', gen_random_uuid());
select t.ok((select status = 'done' and pos_client_uuid is not null from public.appointments where id = :'a'), 'paid: the appointment is done and remembers the sale');
select t.throws(format($q$select public.appt_for_till(%L)$q$, :'a'), 'paid already', 'and is not paid twice');
reset role;

-- 3. the transfer and the adjustment are printed
select tr.id as tr, tr.company_id as trco from public.stock_transfers tr where tr.deleted_at is null
   and exists (select 1 from public.stock_transfer_lines l where l.transfer_id = tr.id) order by tr.created_at limit 1 \gset
select u.email as trwho from public.company_members m join auth.users u on u.id = m.user_id
 where m.company_id = :'trco' and m.status = 'active' and app.has_permission_of(m.user_id, :'trco', 'inventory.read') limit 1 \gset
select ad.id as adj from public.stock_adjustments ad where ad.company_id = :'trco' and ad.deleted_at is null order by ad.created_at limit 1 \gset
set role authenticated;
select t.login(:'trwho');
select public.document_print('stock_transfer', :'tr') as pt \gset
select t.ok(:'pt'::jsonb ->> 'kind' = 'stock_transfer' and jsonb_array_length(:'pt'::jsonb -> 'lines') > 0 and (:'pt'::jsonb -> 'partner' ->> 'name') is not null,
            'a transfer note: from one unit to the other, with its lines');
select t.ok((public.document_print('stock_adjustment', :'adj') ->> 'kind') = 'stock_adjustment', 'an adjustment note');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
