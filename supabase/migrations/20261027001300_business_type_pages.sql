-- =============================================================================
-- What each type of business sees: whole parts of the menu, and now single pages too.
-- company_settings.hidden_menu_sections holds both: a menu part by its name
-- ('Manufacturing'), a page by its address ('/pos/waiters').
-- Applied when the platform creates a client or changes its type; the company's
-- admin can switch any of it back on under Company settings › Menu.
-- =============================================================================
create or replace function app.business_type_hidden_menu(p_type text)
returns text[] language sql immutable set search_path = '' as $$
  select case p_type
    -- a shop, market or supermarket: the till, stock, purchasing and the books
    when 'retail' then array['Warehouse|menu', 'Manufacturing', 'Logistics', 'Hotel',
      '/pos/waiters', '/manufacturing/boms', '/crm/pipeline', '/crm/leads', '/sales/quotes', '/sales/recurring', '/agent', '/sales/agents',
      '/oms/fulfillment', '/procurement/requisitions']
    -- a bar or café: the till with tables and recipes, stock and purchases
    -- (of sales it keeps invoices for companies, promotions such as a happy hour, and customers)
    when 'cafe' then array['Warehouse|menu', 'Manufacturing', 'Logistics', 'Hotel',
      '/sales', '/crm/pipeline', '/crm/leads', '/sales/quotes', '/sales/orders', '/sales/deliveries', '/sales/recurring', '/agent', '/sales/agents', '/sales/price-lists',
      '/inventory/labels', '/inventory/levelling', '/inventory/landed-costs', '/oms/fulfillment', '/procurement/requisitions', '/procurement/replenishment']
    when 'restaurant' then array['Warehouse|menu', 'Manufacturing', 'Logistics', 'Hotel',
      '/sales', '/crm/pipeline', '/crm/leads', '/sales/quotes', '/sales/orders', '/sales/deliveries', '/sales/recurring', '/agent', '/sales/agents', '/sales/price-lists',
      '/inventory/labels', '/inventory/levelling', '/inventory/landed-costs', '/oms/fulfillment', '/procurement/requisitions', '/procurement/replenishment']
    -- a wholesaler or distributor: orders, the warehouse, deliveries and agents; no shop till
    when 'wholesale' then array['Retail', 'Manufacturing', 'Hotel', '/sales/promotions']
    -- a producer: everything but the shop till and the hotel
    when 'manufacturing' then array['Retail', 'Hotel', '/sales/promotions', '/inventory/levelling']
    -- services: quotes, invoices, the books and staff; no goods
    when 'services' then array['Inventory|menu', 'Warehouse|menu', 'Retail', 'Manufacturing', 'Logistics', 'Hotel',
      '/sales/deliveries', '/sales/promotions', '/agent', '/sales/agents', '/oms/fulfillment', '/procurement/replenishment', '/procurement/vendor-prices']
    -- a hotel or guest house: rooms and reservations, the bar's till, purchases and the books
    when 'hotel' then array['Warehouse|menu', 'Manufacturing', 'Logistics',
      '/sales/deliveries', '/sales/promotions', '/sales/recurring', '/agent', '/sales/agents', '/oms/fulfillment',
      '/inventory/labels', '/inventory/levelling', '/inventory/landed-costs', '/procurement/requisitions', '/procurement/replenishment']
    -- everything (only the hotel, which only hotels use)
    else array['Hotel']::text[] end
$$;
