import { useQuery } from '@tanstack/react-query'
import { useCompany } from '@/app/company-provider'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

/** The numbers a market looks at every day (each part only when the person may see it) */
export type MarketNumbers = {
  currency: string
  today?: number; week_ago?: number; receipts?: number; receipts_week_ago?: number; basket?: number | null; month?: number
  month_net?: number; month_margin?: number; month_margin_pct?: number | null
  open_shifts?: number; shifts_left_open?: number; cash_in_tills?: number
  till_diff_count?: number; till_diff?: number; till_diff_abs?: number
  refunds_today?: number; refunded_today?: number; voids_today?: number; voided_today?: number
  expired_lots?: number; expiring_week?: number; expiring_week_value?: number; expiring_month?: number
  out_of_stock_selling?: number; dead_items?: number; dead_value?: number; price_changes?: number
  receipts_waiting_invoice?: number; oldest_waiting_days?: number | null
}

export function useDashboardMarket() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: ['sales', companyId, 'dashboard-market'],
    enabled: !!companyId,
    refetchInterval: 120_000,
    queryFn: async () => unwrap(await supabase.rpc('dashboard_market', { p_company: companyId! })) as unknown as MarketNumbers,
  })
}

/** the groups of the card chooser */
export type CardGroup = 'shop' | 'stock' | 'money' | 'office'

/** the eight cards a new person sees first, by the kind of business */
export function usualCards(businessType: string | undefined, sales: boolean, tills = false): string[] {
  // a company of every kind (or not set) that sells at tills is looked at like a market
  const kind = (!businessType || businessType === 'general') && tills ? 'retail' : businessType
  switch (kind) {
    case 'retail':
      // today's sales are in the day's sentence above the cards: the basket instead
      return ['basket', 'cash_in_tills', 'margin_month', 'out_of_stock', 'expiring', 'till_diff', 'waiting_invoice', 'bills_due']
    case 'cafe': case 'restaurant':
      return ['cash_in_tills', 'basket', 'margin_month', 'voids_today', 'till_diff', 'low_stock', 'bills_due', 'approvals']
    case 'hotel': case 'beauty': case 'clinic': case 'auto_service': case 'fitness':
      return ['today_sales', 'sales_month_all', 'cash_in_tills', 'overdue', 'customers_late', 'cash', 'bills_due', 'approvals']
    case 'services':
      return ['sales_month', 'overdue', 'customers_late', 'quotes', 'cash', 'net_profit', 'bills_due', 'approvals']
    default:
      return ['stock_value', 'low_stock', 'customs', 'approvals', 'sales_month', sales ? 'overdue' : 'customers_late', 'bills_due', sales ? 'backlog' : 'net_profit']
  }
}
