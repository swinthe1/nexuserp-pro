-- =============================================================================
-- The menu by the work people do: Sell, Buy, Money, Taxes and books (the
-- other parts keep their names). The parts a company switched off keep
-- being off under their new names.
-- =============================================================================
update public.company_settings s
   set hidden_menu_sections = (
     select coalesce(array_agg(distinct case x
              when 'Sales & CRM' then 'Sell|menu'
              when 'Purchasing' then 'Buy|menu'
              when 'Finance' then 'Money'
              when 'Tax|menu' then 'Taxes and books'
              else x end), '{}')
       from unnest(s.hidden_menu_sections) x)
 where s.hidden_menu_sections && array['Sales & CRM', 'Purchasing', 'Finance', 'Tax|menu'];
