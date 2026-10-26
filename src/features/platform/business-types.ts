import { msg } from '@/i18n'

export type BusinessType = 'general' | 'retail' | 'cafe' | 'restaurant' | 'wholesale' | 'manufacturing' | 'services' | 'hotel'

/** What each type of business starts with. The menu parts it leaves out are set on the server (app.business_type_hidden_menu). */
export const BUSINESS_TYPES: { value: BusinessType; label: string; hint: string }[] = [
  { value: 'retail', label: msg('Shop or market'), hint: msg('Till, stock, purchasing and accounting. Without manufacturing and delivery planning.') },
  { value: 'cafe', label: msg('Bar or café'), hint: msg('Till, stock and purchasing. Without quotes and pipeline, warehouse floor, manufacturing and logistics.') },
  { value: 'restaurant', label: msg('Restaurant'), hint: msg('Like a café: till, stock and purchasing, without the parts a kitchen does not use.') },
  { value: 'wholesale', label: msg('Wholesale or distributor'), hint: msg('Sales orders, warehouse, deliveries and accounting. Without the shop till and manufacturing.') },
  { value: 'manufacturing', label: msg('Manufacturer'), hint: msg('Everything except the shop till.') },
  { value: 'services', label: msg('Services'), hint: msg('Quotes, invoices, accounting and staff. Without stock, warehouse, till, manufacturing and logistics.') },
  { value: 'hotel', label: msg('Hotel or guest house'), hint: msg('Rooms, reservations calendar, check-in and check-out to an invoice, plus the till for the bar. Without warehouse floor, manufacturing and logistics.') },
  { value: 'general', label: msg('Everything'), hint: msg('The whole menu. Hide what is not used under Company settings → Menu.') },
]

export function businessTypeLabel(v: string | null | undefined) {
  return BUSINESS_TYPES.find((x) => x.value === v)?.label ?? BUSINESS_TYPES[BUSINESS_TYPES.length - 1].label
}
