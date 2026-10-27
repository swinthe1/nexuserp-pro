import {
  Bell, Printer, CalendarDays, CalendarClock, ClipboardPen, Contact, FileBarChart, FileSpreadsheet, Fingerprint, Globe, History, Import, KeyRound, Archive, ListOrdered,
  MapPinned, PackageCheck as PackageDone, Route, ShieldCheck, UserRound, UsersRound, Workflow, Zap,
  BadgePercent, ClipboardCheck, Hourglass, PackageOpen, ScanLine, ShoppingBasket,
  ArrowDownToLine, ArrowLeftRight, BadgeDollarSign, Cog, Layers, Banknote, BookOpenText, Building, HandCoins, ListTree, Network, Settings2, Wallet, BarChart3, Boxes, Building2, ClipboardList, Factory, FileCheck2, FileStack, FileText, Gauge,
  Kanban, Landmark, LayoutDashboard, Magnet, PackageCheck, PackagePlus, PackageSearch, Receipt, RefreshCw, Scale, Ship, ShoppingBag, ShoppingCart,
  BedDouble, BookUser, CalendarRange, ConciergeBell, Repeat, ScanText, SlidersHorizontal, Store, Tag, Tags, CalendarCheck, Percent, Truck, TriangleAlert, Users, Vault, Warehouse, Smartphone, Plug, ReceiptText, IdCard, Settings, CreditCard, type LucideIcon,
} from 'lucide-react'
import { msg } from '@/i18n'

export interface NavItem {
  label: string
  href: string
  icon: LucideIcon
  perm: string
  keywords?: string[]
}
export interface NavSection { label: string; items: NavItem[] }

export const NAV: NavSection[] = [
  {
    label: msg('Overview'),
    items: [{ label: msg('Dashboard'), href: '/', icon: LayoutDashboard, perm: 'core.read', keywords: ['home', 'kpi'] }],
  },
  {
    label: msg('Inventory|menu'),
    items: [
      { label: msg('Products'), href: '/inventory/products', icon: Boxes, perm: 'inventory.read', keywords: ['items', 'sku', 'variants', 'barcode'] },
      { label: msg('Stock levels'), href: '/inventory/stock', icon: PackageSearch, perm: 'inventory.read', keywords: ['on hand', 'available', 'reserved', 'valuation'] },
      { label: msg('Item card'), href: '/inventory/item-card', icon: FileStack, perm: 'inventory.read', keywords: ['kartela', 'kartela e artikullit', 'item ledger', 'stock card', 'lëvizjet'] },
      { label: msg('Labels'), href: '/inventory/labels', icon: Tag, perm: 'inventory.read', keywords: ['etiketa', 'etiketat', 'barkod', 'barcode', 'shelf', 'raft', 'çmim', 'printo'] },
      { label: msg('Movements'), href: '/inventory/movements', icon: FileStack, perm: 'inventory.read', keywords: ['ledger', 'history'] },
      { label: msg('Low stock'), href: '/inventory/alerts', icon: TriangleAlert, perm: 'inventory.read', keywords: ['reorder', 'alerts', 'replenish'] },
      { label: msg('Price levelling'), href: '/inventory/levelling', icon: Tags, perm: 'inventory.read', keywords: ['nivelim', 'nivelimi', 'nivelimi i cmimeve', 'ndryshim cmimi', 'price change', 'repricing'] },
      { label: msg('New selling prices'), href: '/inventory/prices', icon: Tags, perm: 'inventory.read', keywords: ['margin', 'markup', 'price', 'cost', 'marzh', 'cmim'] },
      { label: msg('Goods receipts'), href: '/inventory/receipts', icon: PackageCheck, perm: 'inventory.read', keywords: ['grn', 'receive', 'import'] },
      { label: msg('Invoice from a photo'), href: '/inventory/read-invoice', icon: ScanText, perm: 'inventory.read', keywords: ['ocr', 'scan', 'photo', 'foto', 'fatura', 'ai', 'pdf'] },
      { label: msg('Landed costs'), href: '/inventory/landed-costs', icon: Ship, perm: 'procurement.read', keywords: ['customs', 'freight', 'import', 'clearance'] },
      { label: msg('Adjustments'), href: '/inventory/adjustments', icon: SlidersHorizontal, perm: 'inventory.read', keywords: ['opening', 'write-off', 'damage'] },
      { label: msg('Transfers'), href: '/inventory/transfers', icon: ArrowLeftRight, perm: 'inventory.read', keywords: ['move', 'warehouse'] },
      { label: msg('Warehouses'), href: '/inventory/warehouses', icon: Warehouse, perm: 'inventory.read', keywords: ['locations', 'bins'] },
      { label: msg('Inventory setup'), href: '/inventory/setup', icon: PackagePlus, perm: 'inventory.read', keywords: ['categories', 'units', 'attributes'] },
    ],
  },
  {
    label: msg('Sales & CRM'),
    items: [
      { label: msg('Sales overview'), href: '/sales', icon: BadgeDollarSign, perm: 'sales.read', keywords: ['revenue', 'kpi', 'performance', 'metrics'] },
      { label: msg('Pipeline'), href: '/crm/pipeline', icon: Kanban, perm: 'crm.read', keywords: ['opportunities', 'deals', 'crm', 'kanban'] },
      { label: msg('Leads'), href: '/crm/leads', icon: Magnet, perm: 'crm.read', keywords: ['prospects', 'enquiries', 'crm'] },
      { label: msg('Quotes'), href: '/sales/quotes', icon: FileText, perm: 'sales.read', keywords: ['offer', 'proposal', 'estimate', 'oferta'] },
      { label: msg('Sales orders'), href: '/sales/orders', icon: ShoppingBag, perm: 'sales.read', keywords: ['so', 'orders', 'porosi'] },
      { label: msg('Deliveries'), href: '/sales/deliveries', icon: Truck, perm: 'sales.read', keywords: ['shipping', 'dispatch', 'flete'] },
      { label: msg('Customer invoices'), href: '/sales/invoices', icon: Receipt, perm: 'invoicing.read', keywords: ['invoice', 'fatura', 'credit note', 'billing'] },
      { label: msg('Recurring invoices'), href: '/sales/recurring', icon: Repeat, perm: 'invoicing.read', keywords: ['rent', 'subscription', 'qira', 'abonim', 'monthly'] },
      { label: msg('Agent app'), href: '/agent', icon: Smartphone, perm: 'sales.write', keywords: ['agjent', 'terren', 'field', 'route', 'rruga', 'arkëtim', 'van', 'shitës', 'porosi'] },
      { label: msg('Field agents'), href: '/sales/agents', icon: MapPinned, perm: 'sales.approve', keywords: ['agjentët', 'terren', 'field sales', 'routes', 'visits', 'vizita', 'gps'] },
      { label: msg('Promotions'), href: '/sales/promotions', icon: Percent, perm: 'sales.read', keywords: ['promocion', 'promocione', 'aksion', 'zbritje', '3 me 2', 'offer', 'sale', 'happy hour'] },
      { label: msg('Price lists'), href: '/sales/price-lists', icon: Tags, perm: 'sales.read', keywords: ['pricing', 'wholesale', 'retail', 'discount'] },
      { label: msg('Customers'), href: '/partners?role=customer', icon: Users, perm: 'partners.read', keywords: ['clients', 'partners', 'vendors', 'klient'] },
    ],
  },
  {
    label: msg('Purchasing'),
    items: [
      { label: msg('Purchasing overview'), href: '/procurement', icon: Gauge, perm: 'procurement.read', keywords: ['spend', 'procurement', 'kpi', 'blerje'] },
      { label: msg('Requisitions'), href: '/procurement/requisitions', icon: ClipboardList, perm: 'requisitions.read', keywords: ['request', 'purchase request', 'pr', 'kërkesë'] },
      { label: msg('Purchase orders'), href: '/procurement/orders', icon: ShoppingCart, perm: 'procurement.read', keywords: ['po', 'buy', 'order', 'porosi blerje'] },
      { label: msg('Replenishment|menu'), href: '/procurement/replenishment', icon: RefreshCw, perm: 'procurement.read', keywords: ['reorder', 'mrp', 'suggestions', 'restock'] },
      { label: msg('Vendor bills'), href: '/procurement/bills', icon: FileCheck2, perm: 'invoicing.read', keywords: ['bill', 'ap', 'payable', 'three-way match', 'faturë blerje'] },
      { label: msg('Order desk'), href: '/oms/fulfillment', icon: ListOrdered, perm: 'sales.read', keywords: ['oms', 'backorders', 'fulfilment', 'allocation', 'open orders', 'short'] },
      { label: msg('Vendor prices'), href: '/procurement/vendor-prices', icon: Tags, perm: 'procurement.read', keywords: ['vendor price list', 'supplier prices', 'lead time', 'moq'] },
      { label: msg('Vendors'), href: '/partners?role=vendor', icon: Factory, perm: 'partners.read', keywords: ['suppliers', 'furnitor'] },
    ],
  },
  {
    label: msg('Warehouse|menu'),
    items: [
      { label: msg('Warehouse floor'), href: '/wms', icon: ScanLine, perm: 'wms.read', keywords: ['wms', 'scanner', 'handheld', 'magazina'] },
      { label: msg('Receive'), href: '/wms/receive', icon: PackageCheck, perm: 'wms.read', keywords: ['receiving', 'dock', 'grn', 'scan in'] },
      { label: msg('Put away'), href: '/wms/putaway', icon: PackageOpen, perm: 'wms.read', keywords: ['putaway', 'bins', 'storage'] },
      { label: msg('Pick'), href: '/wms/picking', icon: ShoppingBasket, perm: 'wms.read', keywords: ['picking', 'pick list', 'orders'] },
      { label: msg('Ship'), href: '/wms/shipping', icon: Truck, perm: 'wms.read', keywords: ['shipping', 'dispatch', 'tracking', 'carrier'] },
      { label: msg('Move stock'), href: '/wms/move', icon: ArrowLeftRight, perm: 'wms.read', keywords: ['bin to bin', 'relocate', 'internal transfer'] },
      { label: msg('Cycle counts'), href: '/wms/counts', icon: ClipboardCheck, perm: 'wms.read', keywords: ['inventory count', 'stocktake', 'inventarizim'] },
      { label: msg('Lots & expiry'), href: '/wms/lots', icon: Hourglass, perm: 'inventory.read', keywords: ['batch', 'serial', 'traceability', 'recall', 'fefo', 'expiry'] },
    ],
  },
  {
    label: msg('Retail'),
    items: [
      { label: msg('Point of sale'), href: '/pos', icon: Store, perm: 'pos.read', keywords: ['pos', 'till', 'cashier', 'arka', 'z-report', 'register'] },
      { label: msg('Recipes'), href: '/manufacturing/boms', icon: Layers, perm: 'manufacturing.read', keywords: ['receta', 'recipe', 'kit', 'ingredients', 'përbërës', 'kafe', 'restorant'] },
      { label: msg('Waiters'), href: '/pos/waiters', icon: UsersRound, perm: 'pos.read', keywords: ['kamarier', 'kamarierët', 'waiter', 'restaurant', 'tavolina', 'report'] },
      { label: msg('Safe|nav'), href: '/safe', icon: Vault, perm: 'pos.approve|finance.read', keywords: ['sefi', 'sef', 'kasaforta', 'cash', 'deposit', 'derdhje', 'para', 'count'] },
      { label: msg('Loyalty cards'), href: '/pos/loyalty', icon: BadgePercent, perm: 'pos.read', keywords: ['kartela', 'zbritje', 'loyalty', 'points', 'pikë', 'besnikëri', 'discount card'] },
    ],
  },
  {
    label: msg('Appointments'),
    items: [
      { label: msg('Appointment calendar'), href: '/appointments', icon: CalendarClock, perm: 'sales.read', keywords: ['termin', 'terminet', 'takim', 'rezervim', 'kalendar', 'booking', 'salon', 'klinikë', 'servis'] },
      { label: msg('Client cards'), href: '/appointments/cards', icon: IdCard, perm: 'sales.read', keywords: ['kartela', 'pacient', 'automjet', 'targa', 'vetura', 'kafshë', 'historiku', 'vehicle', 'patient', 'pet'] },
      { label: msg('Memberships'), href: '/appointments/memberships', icon: CreditCard, perm: 'sales.read', keywords: ['anëtarësim', 'abonim', 'palestër', 'gym', 'karta', 'hyrje', 'membership'] },
      { label: msg('Services and staff'), href: '/appointments/setup', icon: Settings, perm: 'sales.read', keywords: ['shërbime', 'punëtorë', 'orari', 'karrige', 'ngritës'] },
    ],
  },
  {
    label: msg('Hotel'),
    items: [
      { label: msg('Front desk'), href: '/hotel', icon: ConciergeBell, perm: 'sales.read', keywords: ['recepsion', 'reception', 'hotel', 'arrivals', 'mbërritje', 'check-in', 'check-out'] },
      { label: msg('Room calendar'), href: '/hotel/calendar', icon: CalendarRange, perm: 'sales.read', keywords: ['kalendar', 'dhoma', 'rooms', 'availability', 'zënie', 'planner'] },
      { label: msg('Reservations'), href: '/hotel/reservations', icon: BookUser, perm: 'sales.read', keywords: ['rezervim', 'rezervime', 'booking', 'guest', 'mysafir', 'klient'] },
      { label: msg('Rooms'), href: '/hotel/rooms', icon: BedDouble, perm: 'sales.read', keywords: ['dhoma', 'housekeeping', 'pastrim', 'room types', 'çmime'] },
    ],
  },
  {
    label: msg('Manufacturing'),
    items: [
      { label: msg('Production overview'), href: '/manufacturing', icon: Gauge, perm: 'manufacturing.read', keywords: ['production', 'mrp', 'plan', 'prodhim', 'capacity'] },
      { label: msg('Work orders|menu'), href: '/manufacturing/orders', icon: Factory, perm: 'manufacturing.read', keywords: ['wo', 'production order', 'manufacturing order', 'urdhër pune'] },
      { label: msg('Bills of materials'), href: '/manufacturing/boms', icon: Layers, perm: 'manufacturing.read', keywords: ['bom', 'recipe', 'formula', 'structure', 'recetë'] },
      { label: msg('Work centers'), href: '/manufacturing/work-centers', icon: Cog, perm: 'manufacturing.read', keywords: ['machines', 'lines', 'capacity', 'rates'] },
    ],
  },
  {
    label: msg('Logistics'),
    items: [
      { label: msg('Logistics overview'), href: '/logistics', icon: Truck, perm: 'logistics.read', keywords: ['transport', 'fleet', 'kpi', 'transport'] },
      { label: msg('Delivery planning'), href: '/logistics/planning', icon: MapPinned, perm: 'logistics.read', keywords: ['routes', 'dispatch', 'vans', 'drivers', 'plan'] },
      { label: msg('Shipments'), href: '/logistics/shipments', icon: Route, perm: 'logistics.read', keywords: ['tracking', 'carrier', 'cod', 'cash on delivery', 'dërgesa'] },
      { label: msg('Carriers and fleet'), href: '/logistics/setup', icon: PackageDone, perm: 'logistics.read', keywords: ['vehicles', 'carriers', 'vans', 'courier'] },
      { label: msg('Web shop'), href: '/ecommerce', icon: Globe, perm: 'ecommerce.read', keywords: ['e-commerce', 'shopify', 'woocommerce', 'online orders', 'channels'] },
    ],
  },
  {
    // what an accountant opens every month, in one place: the books, the VAT return, the statements
    label: msg('Accounting'),
    items: [
      { label: msg('Sales book'), href: '/tax/books', icon: FileSpreadsheet, perm: 'tax.read', keywords: ['libri i shitjes', 'libri i shitjeve', 'sales book', 'vat book', 'tvsh'] },
      { label: msg('Purchase book'), href: '/tax/books?book=purchase', icon: FileSpreadsheet, perm: 'tax.read', keywords: ['libri i blerjes', 'libri i blerjeve', 'purchase book', 'vat book', 'tvsh'] },
      { label: msg('VAT declarations'), href: '/tax/declarations', icon: ClipboardPen, perm: 'tax.read', keywords: ['vat return', 'deklarata', 'tvsh', 'dpt', 'atk'] },
      { label: msg('Small business tax'), href: '/tax/small-business', icon: BadgePercent, perm: 'tax.read', keywords: ['biznes i vogël', 'biznes i vogel', '3%', '9%', 'tremujor', 'qarkullim', 'small business', 'turnover tax'] },
      { label: msg('Z reports'), href: '/finance/z-reports', icon: Printer, perm: 'invoicing.read', keywords: ['z raport', 'z-raporti', 'raporti z', 'arka fiskale', 'kasa', 'fiscal register', 'z report'] },
      { label: msg('Assets from invoices'), href: '/finance/asset-invoices', icon: Building, perm: 'finance.read', keywords: ['mjete themelore', 'faturë', 'foto', 'investim', 'veturë', 'kompjuter', 'asset invoice'] },
      { label: msg('Financial statements'), href: '/finance/reports', icon: BarChart3, perm: 'finance.read', keywords: ['p&l', 'profit and loss', 'balance sheet', 'cash flow', 'trial balance', 'bilanc', 'comparison'] },
      { label: msg('Journal entries'), href: '/finance/journal', icon: BookOpenText, perm: 'finance.read', keywords: ['gl', 'general ledger', 'manual entry', 'ditar'] },
      { label: msg('Cash book|ledger'), href: '/finance/cash-book', icon: Banknote, perm: 'finance.read', keywords: ['libri i arkës', 'arka', 'cash book', 'para në dorë'] },
      { label: msg('Account card'), href: '/finance/account-card', icon: BookOpenText, perm: 'finance.read', keywords: ['kartela e kontos', 'libri kryesor', 'general ledger', 'account ledger'] },
      { label: msg('Item card'), href: '/inventory/item-card?from=accounting', icon: FileStack, perm: 'inventory.read', keywords: ['kartela e artikullit', 'item card', 'lëvizjet'] },
      { label: msg('Chart of accounts'), href: '/finance/accounts', icon: ListTree, perm: 'finance.read', keywords: ['coa', 'ledger', 'plan kontabel', 'accounts'] },
      { label: msg('Partner cards'), href: '/finance/cards', icon: BookOpenText, perm: 'invoicing.read', keywords: ['kartela', 'kartela e klientit', 'kartela e furnitorit', 'ios', 'konfirmim', 'statement', 'saldo'] },
      { label: msg('Partner balances'), href: '/finance/receivables?from=accounting', icon: HandCoins, perm: 'invoicing.read', keywords: ['bilanci i subjekteve', 'saldo', 'borxhet', 'partner balances'] },
      { label: msg('Year-end close'), href: '/finance/year-end', icon: CalendarCheck, perm: 'finance.read', keywords: ['mbyllja e vitit', 'mbyllje', 'year end', 'closing', 'fitimi i vitit', '109', '108'] },
    ],
  },
  {
    label: msg('Finance'),
    items: [
      { label: msg('Finance overview'), href: '/finance', icon: Landmark, perm: 'finance.read', keywords: ['accounting', 'kpi', 'kontabilitet'] },
      { label: msg('Receivables'), href: '/finance/receivables', icon: HandCoins, perm: 'invoicing.read', keywords: ['ar', 'aging', 'debtors', 'overdue'] },
      { label: msg('Expenses'), href: '/finance/expenses', icon: ReceiptText, perm: 'invoicing.read', keywords: ['shpenzime', 'shpenzim', 'karburant', 'naftë', 'rryma', 'kupon', 'faturë', 'foto', 'receipt', 'fuel', 'expense'] },
      { label: msg('Payables'), href: '/finance/payables', icon: Wallet, perm: 'invoicing.read', keywords: ['ap', 'aging', 'creditors', 'due'] },
      { label: msg('Compensations'), href: '/finance/compensations', icon: ArrowLeftRight, perm: 'invoicing.read', keywords: ['kompensim', 'kompensimi', 'offset', 'netting'] },
      { label: msg('Payments'), href: '/finance/payments', icon: Receipt, perm: 'invoicing.read', keywords: ['receipts', 'pay', 'arkëtim', 'pagesë'] },
      { label: msg('Bank and cash'), href: '/finance/bank', icon: Banknote, perm: 'finance.read', keywords: ['reconciliation', 'statement', 'banka'] },
      { label: msg('Fixed assets'), href: '/finance/assets', icon: Building, perm: 'finance.read', keywords: ['depreciation', 'amortization', 'aktive'] },
      { label: msg('Cost centers'), href: '/finance/cost-centers', icon: Network, perm: 'finance.read', keywords: ['departments', 'branches', 'projects'] },
      { label: msg('Finance setup'), href: '/finance/setup', icon: Settings2, perm: 'finance.read', keywords: ['posting accounts', 'periods', 'close', 'fiscal year', 'journals'] },
    ],
  },
  {
    label: msg('Tax|menu'),
    items: [
      { label: msg('Tax overview'), href: '/tax', icon: Scale, perm: 'tax.read', keywords: ['vat', 'tvsh', 'calendar', 'deadlines', 'tatime'] },
      { label: msg('Fiscalization'), href: '/tax/fiscalization', icon: Fingerprint, perm: 'tax.read', keywords: ['nivf', 'nslf', 'iic', 'fic', 'cis', 'efiskalizimi', 'qr'] },
      { label: msg('Withholding tax'), href: '/tax/withholding', icon: Landmark, perm: 'tax.read', keywords: ['tatim në burim', 'tatimi në burim', 'withholding', 'qira', 'rent', 'wht'] },
      { label: msg('Corporate income tax'), href: '/tax/income-tax', icon: Percent, perm: 'tax.read', keywords: ['tatimi mbi fitimin', 'tatim fitimi', 'cit', 'profit tax', 'deklarata vjetore'] },
      { label: msg('Tax codes'), href: '/tax/codes', icon: Tags, perm: 'tax.read', keywords: ['vat rates', 'exempt', 'reverse charge'] },
    ],
  },
  {
    label: msg('People'),
    items: [
      { label: msg('People overview'), href: '/hr', icon: UsersRound, perm: 'hr.read', keywords: ['hr', 'headcount', 'burime njerëzore'] },
      { label: msg('Employees|menu'), href: '/hr/employees', icon: Contact, perm: 'hr.read', keywords: ['staff', 'punonjës', 'contracts'] },
      { label: msg('Leave'), href: '/hr/leave', icon: CalendarDays, perm: 'hr.read', keywords: ['holiday', 'vacation', 'pushime', 'absence', 'sick'] },
      { label: msg('Attendance'), href: '/hr/attendance', icon: CalendarClock, perm: 'hr.read', keywords: ['timesheet', 'clock in', 'prezenca', 'overtime'] },
      { label: msg('Payroll'), href: '/hr/payroll', icon: Wallet, perm: 'payroll.read', keywords: ['salaries', 'payslips', 'listëpagesa', 'tap', 'contributions', 'paga'] },
      { label: msg('My workplace'), href: '/hr/me', icon: UserRound, perm: 'core.read', keywords: ['my leave', 'my payslips', 'clock in', 'self-service'] },
    ],
  },
  {
    label: msg('Company'),
    items: [
      { label: msg('Reports'), href: '/reports', icon: FileBarChart, perm: 'core.read', keywords: ['analytics', 'sales analysis', 'margin', 'valuation', 'aging', 'raporte'] },
      { label: msg('History from the old program'), href: '/history', icon: Archive, perm: 'invoicing.read', keywords: ['historiku', 'logmicro', 'arkiv', 'archive', 'old program', 'kubit', 'bilanc'] },
      { label: msg('Approvals'), href: '/approvals', icon: Gauge, perm: 'core.read', keywords: ['approve', 'pending', 'inbox'] },
      { label: msg('Notifications'), href: '/notifications', icon: Bell, perm: 'core.read', keywords: ['alerts', 'inbox', 'reminders', 'njoftime'] },
      { label: msg('Company settings'), href: '/settings', icon: Building2, perm: 'admin.read', keywords: ['profile', 'nipt', 'fiscal codes', 'preferences'] },
      { label: msg('Users and roles'), href: '/settings/users', icon: KeyRound, perm: 'admin.read', keywords: ['invite', 'members', 'permissions', 'roles', 'access'] },
      { label: msg('Approval workflows'), href: '/settings/workflows', icon: Workflow, perm: 'admin.read', keywords: ['approval limits', 'approvers'] },
      { label: msg('Automations'), href: '/settings/automation', icon: Zap, perm: 'core.read', keywords: ['automatic', 'schedule', 'automatizim', 'email', 'whatsapp', 'reminders'] },
      { label: msg('Numbering'), href: '/settings/numbering', icon: ListOrdered, perm: 'admin.read', keywords: ['sequences', 'prefix', 'document numbers'] },
      { label: msg('Move from another program'), href: '/settings/migration', icon: ArrowDownToLine, perm: 'admin.write', keywords: ['migration', 'kubit', 'logmicro', 'bilanc', 'pantheon', 'opening balances', 'cut-over', 'kalimi', 'migrimi'] },
      { label: msg('B2B portal and API'), href: '/settings/integrations', icon: Plug, perm: 'admin.read', keywords: ['api', 'b2b', 'portal', 'portali', 'web shop', 'dyqan online', 'integrim', 'key', 'çelës', 'woocommerce', 'shopify', 'chatgpt', 'claude', 'mcp', 'ai'] },
      { label: msg('Import data'), href: '/settings/import', icon: Import, perm: 'core.read', keywords: ['csv', 'excel', 'upload', 'migration', 'opening balances'] },
      { label: msg('Audit log'), href: '/settings/audit', icon: History, perm: 'audit.read', keywords: ['history', 'changes', 'who changed'] },
      { label: msg('Security'), href: '/settings/roles', icon: ShieldCheck, perm: 'admin.read', keywords: ['roles', 'permission matrix', 'custom role'] },
    ],
  },
]
