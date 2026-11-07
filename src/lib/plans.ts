import { msg } from '@/i18n'

/** What a licence can include (the server decides; see app.plan_features and app.all_modules). */
export type Feature = 'transfers' | 'accounting' | 'restaurant' | 'imports' | 'approvals' | 'hr' | 'wms' | 'manufacturing' | 'logistics' | 'ecommerce' | 'livesync'
  | 'ai_reads' | 'ai_assistant' | 'whatsapp'
  | 'pos' | 'safe' | 'promotions' | 'scales' | 'purchase_orders' | 'quotes' | 'sales_orders' | 'agents' | 'price_lists' | 'crm' | 'hotel' | 'appointments'

export type ModuleGroup = 'shop' | 'restaurant' | 'stock' | 'buying' | 'selling' | 'money' | 'more' | 'paid'
export const MODULE_GROUPS: { key: ModuleGroup; label: string }[] = [
  { key: 'shop', label: msg('The till and the shop') }, { key: 'restaurant', label: msg('Restaurant and café') },
  { key: 'stock', label: msg('Stock and warehouse') }, { key: 'buying', label: msg('Buying') }, { key: 'selling', label: msg('Selling with invoices') },
  { key: 'money', label: msg('Money and the books') }, { key: 'more', label: msg('Other kinds of business') }, { key: 'paid', label: msg('With a cost per use') },
]
/** every module, in its group; plan: the older plans it came with ('basic' = in all of them) */
export const FEATURES: { key: Feature; label: string; hint?: string; group: ModuleGroup; plan: 'basic' | 'standard' | 'pro' | 'paid'; cost?: string }[] = [
  { key: 'pos', label: msg('The till'), hint: msg('Shifts, receipts, closing and reconciling, X and Z reports'), group: 'shop', plan: 'basic' },
  { key: 'safe', label: msg('The safe'), hint: msg('The cash of the tills, deposits to the bank, counts'), group: 'shop', plan: 'basic' },
  { key: 'promotions', label: msg('Promotions and cards'), hint: msg('Discounts by time, loyalty cards, gift vouchers'), group: 'shop', plan: 'basic' },
  { key: 'scales', label: msg('Scales'), hint: msg('Prices sent to the scales, scale barcodes'), group: 'shop', plan: 'basic' },
  { key: 'restaurant', label: msg('Restaurant'), hint: msg('Tables, kitchen screen, recipes, waiters'), group: 'restaurant', plan: 'standard' },
  { key: 'transfers', label: msg('Transfers between stores'), group: 'stock', plan: 'standard' },
  { key: 'wms', label: msg('Advanced warehouse'), hint: msg('Locations, receiving, putaway, picking and shipping'), group: 'stock', plan: 'pro' },
  { key: 'purchase_orders', label: msg('Purchase orders'), hint: msg('Orders to suppliers, requests, replenishment, contracts'), group: 'buying', plan: 'basic' },
  { key: 'imports', label: msg('Imports and customs costs'), group: 'buying', plan: 'standard' },
  { key: 'quotes', label: msg('Quotes'), group: 'selling', plan: 'basic' },
  { key: 'sales_orders', label: msg('Sales orders and deliveries'), hint: msg('Orders, delivery notes, recurring invoices'), group: 'selling', plan: 'basic' },
  { key: 'price_lists', label: msg('Price lists'), group: 'selling', plan: 'basic' },
  { key: 'agents', label: msg('Field agents'), group: 'selling', plan: 'basic' },
  { key: 'crm', label: msg('Leads and pipeline'), group: 'selling', plan: 'basic' },
  { key: 'ecommerce', label: msg('Web shop'), group: 'selling', plan: 'pro' },
  { key: 'accounting', label: msg('Full accounting'), hint: msg('Journal, chart of accounts, financial statements, fixed assets'), group: 'money', plan: 'standard' },
  { key: 'approvals', label: msg('Approvals'), group: 'money', plan: 'standard' },
  { key: 'hr', label: msg('People and payroll'), group: 'money', plan: 'standard' },
  { key: 'manufacturing', label: msg('Production'), group: 'more', plan: 'pro' },
  { key: 'logistics', label: msg('Logistics'), group: 'more', plan: 'pro' },
  { key: 'hotel', label: msg('Hotel'), hint: msg('Rooms, reservations, check-in and check-out'), group: 'more', plan: 'basic' },
  { key: 'appointments', label: msg('Appointments'), hint: msg('Bookings, client cards, memberships'), group: 'more', plan: 'basic' },
  { key: 'livesync', label: msg('Live link with the old program'), group: 'more', plan: 'pro' },
  // in no plan: each use costs DrisPRO money, so the client chooses them and they go in the offer
  { key: 'ai_reads', label: msg('Supplier invoices read with AI'), group: 'paid', plan: 'paid', cost: msg('about 1–3 cents per invoice (Claude)') },
  { key: 'ai_assistant', label: msg('The DrisPRO assistant'), group: 'paid', plan: 'paid', cost: msg('about 1–3 cents per question (Claude)') },
  { key: 'whatsapp', label: msg('WhatsApp messages'), group: 'paid', plan: 'paid', cost: msg('about 1–5 cents per conversation (Meta)') },
]
export const PAID_MODULES = FEATURES.filter((f) => f.plan === 'paid')

export const PLAN_FEATURES: Record<string, Feature[]> = {
  basic: FEATURES.filter((f) => f.plan === 'basic').map((f) => f.key),
  standard: FEATURES.filter((f) => f.plan === 'basic' || f.plan === 'standard').map((f) => f.key),
  /** a package: the licence's own list of modules */
  package: [],
  pro: FEATURES.filter((f) => f.plan !== 'paid').map((f) => f.key),
  trial: FEATURES.filter((f) => f.plan !== 'paid').map((f) => f.key),
}
export const PLAN_STORES: Record<string, number | null> = { basic: 1, standard: 5, pro: null, trial: null }

/** Pages that belong to a feature (first match wins; any of the listed features opens it). */
const PAGE_FEATURES: [string, Feature[]][] = [
  ['/pos/floor', ['restaurant']], ['/pos/kitchen', ['restaurant']], ['/pos/waiters', ['restaurant']],
  ['/pos/vouchers', ['promotions']], ['/pos/loyalty', ['promotions']], ['/sales/promotions', ['promotions']],
  ['/pos', ['pos', 'restaurant']], ['/finance/z-reports', ['pos', 'restaurant']], ['/tax/fiscalization', ['pos', 'restaurant']],
  ['/safe', ['safe']],
  ['/inventory/scale-prices', ['scales']],
  ['/procurement/orders', ['purchase_orders']], ['/procurement/requisitions', ['purchase_orders']], ['/procurement/rfqs', ['purchase_orders']],
  ['/procurement/replenishment', ['purchase_orders']], ['/procurement/contracts', ['purchase_orders']],
  ['/sales/quotes', ['quotes']], ['/sales/orders', ['sales_orders']], ['/sales/deliveries', ['sales_orders']], ['/sales/recurring', ['sales_orders']],
  ['/sales/price-lists', ['price_lists']], ['/agent', ['agents']], ['/sales/agents', ['agents']],
  ['/crm', ['crm']], ['/hotel', ['hotel']], ['/appointments', ['appointments']],
  ['/inventory/transfers', ['transfers']],
  ['/inventory/landed-costs', ['imports']],
  ['/wms/counts', []], ['/wms/lots', []],
  ['/wms', ['wms']],
  ['/oms', ['ecommerce']], ['/ecommerce', ['ecommerce']],
  ['/manufacturing/boms', ['manufacturing', 'restaurant']],
  ['/manufacturing', ['manufacturing']],
  ['/logistics', ['logistics']],
  ['/finance/reports', ['accounting']], ['/finance/journal', ['accounting']], ['/finance/accounts', ['accounting']],
  ['/finance/assets', ['accounting']], ['/finance/cost-centers', ['accounting']],
  ['/hr', ['hr']],
  ['/approvals', ['approvals']], ['/settings/workflows', ['approvals']],
  ['/history', ['livesync']],
  ['/inventory/read-invoice', ['ai_reads']],
]
export function pageFeatures(path: string): Feature[] {
  const p = path.split('?')[0]
  for (const [prefix, f] of PAGE_FEATURES) if (p === prefix || p.startsWith(`${prefix}/`)) return f
  return []
}

/** Permission modules that belong to a feature (the server refuses them the same way). */
export function moduleAllowed(features: readonly string[] | null | undefined, module: string) {
  if (!features) return true
  const has = (f: Feature) => features.includes(f)
  switch (module) {
    case 'manufacturing': return has('manufacturing') || has('restaurant')
    case 'logistics': return has('logistics')
    case 'hr': case 'payroll': return has('hr')
    case 'ecommerce': case 'oms': return has('ecommerce')
    case 'pos': return has('pos') || has('restaurant')
    case 'crm': return has('crm')
    default: return true
  }
}

/* ------------------------------------------------------------------ packages by business */
export type PackageKey = 'retail_mini' | 'retail_market' | 'retail_chain' | 'cafe' | 'restaurant' | 'wholesale' | 'manufacturing' | 'services'
  | 'hotel' | 'beauty' | 'clinic' | 'auto_service' | 'fitness' | 'general'
export type Package = { key: PackageKey; businessType: string; label: string; hint: string
  /** on from the start */
  modules: Feature[]
  /** offered to this kind of client (switched on when he asks) */
  optional: Feature[]
  /** units, tills and users (null = no limit); the same as the server's app.package_info */
  stores: number | null; tills: number | null; users: number }
const ALL_BUT_PAID = FEATURES.filter((f) => f.plan !== 'paid').map((f) => f.key)
const SHOP: Feature[] = ['pos', 'safe', 'promotions']
const PAID: Feature[] = ['ai_reads', 'ai_assistant', 'whatsapp']
export const PACKAGES: Package[] = [
  { key: 'retail_mini', businessType: 'retail', label: msg('Mini market'), hint: msg('A small market or shop: 1 unit, 1–2 tills'),
    modules: [...SHOP], optional: ['scales', 'purchase_orders', 'price_lists', 'accounting', 'hr', ...PAID], stores: 1, tills: 2, users: 4 },
  { key: 'retail_market', businessType: 'retail', label: msg('Market or supermarket'), hint: msg('Up to 5 units and 10 tills, with scales, orders to suppliers and imports'),
    modules: [...SHOP, 'scales', 'transfers', 'purchase_orders', 'imports', 'price_lists'], optional: ['accounting', 'approvals', 'hr', 'wms', 'quotes', 'sales_orders', 'ecommerce', ...PAID], stores: 5, tills: 10, users: 15 },
  { key: 'retail_chain', businessType: 'retail', label: msg('Chain of markets'), hint: msg('Many units with a central warehouse, approvals and the books'),
    modules: [...SHOP, 'scales', 'transfers', 'purchase_orders', 'imports', 'price_lists', 'accounting', 'approvals', 'wms'], optional: ['hr', 'logistics', 'quotes', 'sales_orders', 'ecommerce', 'livesync', ...PAID], stores: null, tills: null, users: 50 },
  { key: 'cafe', businessType: 'cafe', label: msg('Bar or café'), hint: msg('Tables and the bar, recipes, waiters'),
    modules: ['pos', 'restaurant', 'safe', 'promotions'], optional: ['purchase_orders', 'accounting', 'hr', ...PAID], stores: 1, tills: 2, users: 8 },
  { key: 'restaurant', businessType: 'restaurant', label: msg('Restaurant'), hint: msg('Tables, kitchen screen, recipes, waiters'),
    modules: ['pos', 'restaurant', 'safe', 'promotions', 'purchase_orders'], optional: ['transfers', 'imports', 'accounting', 'hr', 'appointments', ...PAID], stores: 1, tills: 3, users: 15 },
  { key: 'wholesale', businessType: 'wholesale', label: msg('Wholesale or distributor'), hint: msg('Orders, delivery notes, agents in the field, price lists'),
    modules: ['quotes', 'sales_orders', 'agents', 'price_lists', 'purchase_orders', 'imports', 'transfers', 'accounting', 'approvals'], optional: ['wms', 'logistics', 'crm', 'pos', 'safe', 'hr', 'ecommerce', ...PAID], stores: 3, tills: 2, users: 15 },
  { key: 'manufacturing', businessType: 'manufacturing', label: msg('Manufacturer'), hint: msg('Production with bills of materials, orders and the books'),
    modules: ['manufacturing', 'quotes', 'sales_orders', 'price_lists', 'purchase_orders', 'imports', 'transfers', 'accounting', 'approvals'], optional: ['wms', 'logistics', 'crm', 'agents', 'pos', 'hr', ...PAID], stores: 3, tills: 1, users: 20 },
  { key: 'services', businessType: 'services', label: msg('Services'), hint: msg('Quotes, invoices, recurring invoices, clients'),
    modules: ['quotes', 'sales_orders', 'crm', 'accounting'], optional: ['appointments', 'approvals', 'hr', 'purchase_orders', ...PAID], stores: 1, tills: 1, users: 10 },
  { key: 'hotel', businessType: 'hotel', label: msg('Hotel or guest house'), hint: msg('Rooms and reservations, the bar and the restaurant'),
    modules: ['hotel', 'pos', 'restaurant', 'safe', 'accounting'], optional: ['purchase_orders', 'promotions', 'hr', 'approvals', ...PAID], stores: 1, tills: 3, users: 15 },
  { key: 'beauty', businessType: 'beauty', label: msg('Salon or barber'), hint: msg('Appointments, client cards, the till for products'),
    modules: ['appointments', 'pos', 'safe', 'promotions'], optional: ['hr', 'accounting', ...PAID], stores: 1, tills: 1, users: 6 },
  { key: 'clinic', businessType: 'clinic', label: msg('Clinic, dentist or vet'), hint: msg('Appointments, patient cards, invoices and materials'),
    modules: ['appointments', 'quotes'], optional: ['pos', 'safe', 'accounting', 'hr', ...PAID], stores: 1, tills: 1, users: 10 },
  { key: 'auto_service', businessType: 'auto_service', label: msg('Car service'), hint: msg('Appointments for the lifts, vehicle cards, parts, quotes'),
    modules: ['appointments', 'quotes', 'purchase_orders'], optional: ['pos', 'safe', 'accounting', 'hr', ...PAID], stores: 1, tills: 1, users: 8 },
  { key: 'fitness', businessType: 'fitness', label: msg('Gym or club'), hint: msg('Memberships, check-in at the door, the till for drinks'),
    modules: ['appointments', 'pos', 'safe', 'promotions'], optional: ['hr', 'accounting', ...PAID], stores: 1, tills: 2, users: 8 },
  { key: 'general', businessType: 'general', label: msg('Everything'), hint: msg('Every module, for a business that does a bit of everything'),
    modules: ALL_BUT_PAID, optional: [...PAID], stores: null, tills: null, users: 25 },
]
export const packageOf = (key: string | null | undefined) => PACKAGES.find((p) => p.key === key) ?? null

/** Built-in roles that belong to modules: a client without the module does not see them. */
const ROLE_FEATURES: Record<string, Feature[]> = {
  production_manager: ['manufacturing'], logistics_manager: ['logistics'], hr_manager: ['hr'],
  pos_cashier: ['pos', 'restaurant'], store_manager: ['pos', 'restaurant'],
  sales_rep: ['quotes', 'sales_orders', 'agents', 'crm'], sales_manager: ['quotes', 'sales_orders', 'agents', 'crm', 'price_lists'],
  warehouse_operator: ['wms', 'transfers'], procurement_manager: ['purchase_orders', 'imports'], finance_manager: ['accounting'],
}
export function roleInPackage(key: string | null | undefined, has: (f: Feature) => boolean) {
  const need = key ? ROLE_FEATURES[key] : undefined
  return !need || need.some(has)
}
