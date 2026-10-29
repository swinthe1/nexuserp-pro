import {
  Bell, Printer, CalendarDays, CalendarClock, ClipboardPen, Contact, FileBarChart, Fingerprint, Globe, History, Import, KeyRound, Archive, ListOrdered,
  MapPinned, PackageCheck as PackageDone, Route, ShieldCheck, UserRound, UsersRound, Workflow, Zap,
  BadgePercent, ClipboardCheck, Hourglass, PackageOpen, ScanLine, ShoppingBasket,
  ArrowDownToLine, ArrowLeftRight, BadgeDollarSign, Cog, Layers, Banknote, Building, HandCoins, ListTree, Network, Settings2, BarChart3, Boxes, Building2, ClipboardList, Factory, FileCheck2, FileStack, FileText, 
  Kanban, Landmark, LayoutDashboard, Magnet, PackageCheck, PackageSearch, Receipt, RefreshCw, Scale, Ship, ShoppingBag, ShoppingCart,
  BedDouble, BookUser, CalendarRange, ConciergeBell, Repeat, ScanText, SlidersHorizontal, Store, Tag, Tags, CalendarCheck, Percent, Truck, TriangleAlert, Users, Vault, Warehouse, Smartphone, Plug, ReceiptText, IdCard, Settings, CreditCard, type LucideIcon, Activity, ArrowDownLeft, ArrowUpDown, ArrowUpRight, BadgeEuro, BookOpen, CalendarPlus, CheckCheck, CircleDollarSign, Clock, Coins, Combine, FileInput, FileOutput, FileScan, FolderTree, Gift, Handshake, LineChart, Map, Move, NotebookTabs, PieChart, ScanBarcode, Send,
} from 'lucide-react'
import { msg } from '@/i18n'

export interface NavItem {
  label: string
  href: string
  icon: LucideIcon
  perm: string
  keywords?: string[]
  /** for people whose job is one part (till, warehouse, field sales): shown to them when they can do one of these */
  focus?: string[]
  /** shown to everyone who may open it, also in the short menu */
  always?: boolean
  /** shown here too when the same page is in an earlier part of the menu (recipes: the till and production) */
  also?: boolean
  /** a small heading inside a long part of the menu; the items under it share it */
  group?: string
  /** found by the page search, but not listed in the side menu (it has its own place, e.g. the bell) */
  hideInMenu?: boolean
}
/** label: the part's key (also what a company switches off); title: what the menu shows, when it differs */
export interface NavSection { label: string; title?: string; items: NavItem[] }

export const NAV: NavSection[] = [
  {
    label: msg('Overview'),
    items: [
      { label: msg('Dashboard'), href: '/', icon: LayoutDashboard, perm: 'core.read', keywords: ['home', 'kpi'], always: true },
      { label: msg('Approvals|menu'), href: '/approvals', icon: CheckCheck, perm: 'core.read', keywords: ['approve', 'pending', 'inbox'] },
      { label: msg('Notifications'), href: '/notifications', icon: Bell, perm: 'core.read', keywords: ['alerts', 'inbox', 'reminders', 'njoftime'], always: true, hideInMenu: true },
    ],
  },
  {
    // selling: offers, orders, invoices and the customers
    label: msg('Sell|menu'),
    items: [
      { label: msg('Customer invoices'), href: '/sales/invoices', icon: Receipt, perm: 'invoicing.read', group: msg('Documents'), keywords: ['invoice', 'fatura', 'credit note', 'billing'] },
      { label: msg('Quotes'), href: '/sales/quotes', icon: FileText, perm: 'sales.read', keywords: ['offer', 'proposal', 'estimate', 'oferta'] },
      { label: msg('Sales orders'), href: '/sales/orders', icon: ShoppingBag, perm: 'sales.read', keywords: ['so', 'orders', 'porosi'] },
      { label: msg('Deliveries'), href: '/sales/deliveries', icon: Truck, perm: 'sales.read', keywords: ['shipping', 'dispatch', 'flete'] },
      { label: msg('Recurring invoices'), href: '/sales/recurring', icon: Repeat, perm: 'invoicing.read', keywords: ['rent', 'subscription', 'qira', 'abonim', 'monthly'] },
      { label: msg('Order desk|menu'), href: '/oms/fulfillment', icon: ListOrdered, perm: 'sales.read', keywords: ['oms', 'backorders', 'fulfilment', 'allocation', 'open orders', 'short'] },
      { label: msg('Customers'), href: '/partners?role=customer', icon: Users, perm: 'partners.read', group: msg('Customers and prices'), keywords: ['clients', 'partners', 'vendors', 'klient'], focus: ['sales.write', 'pos.write'] },
      { label: msg('Price lists'), href: '/sales/price-lists', icon: Tags, perm: 'sales.read', keywords: ['pricing', 'wholesale', 'retail', 'discount'] },
      { label: msg('Promotions'), href: '/sales/promotions', icon: Gift, perm: 'sales.read', keywords: ['promocion', 'promocione', 'aksion', 'zbritje', '3 me 2', 'offer', 'sale', 'happy hour'] },
      { label: msg('Leads'), href: '/crm/leads', icon: Magnet, perm: 'crm.read', group: msg('New customers'), keywords: ['prospects', 'enquiries', 'crm'] },
      { label: msg('Pipeline|menu'), href: '/crm/pipeline', icon: Kanban, perm: 'crm.read', keywords: ['opportunities', 'deals', 'crm', 'kanban'] },
      { label: msg('Agent app'), href: '/agent', icon: Smartphone, perm: 'sales.write', group: msg('In the field and online'), keywords: ['agjent', 'terren', 'field', 'route', 'rruga', 'arkëtim', 'van', 'shitës', 'porosi'] },
      { label: msg('Field agents'), href: '/sales/agents', icon: MapPinned, perm: 'sales.approve', keywords: ['agjentët', 'terren', 'field sales', 'routes', 'visits', 'vizita', 'gps'] },
      { label: msg('Web shop'), href: '/ecommerce', icon: Globe, perm: 'ecommerce.read', keywords: ['e-commerce', 'shopify', 'woocommerce', 'online orders', 'channels'] },
    ],
  },
  {
    // the shop or café till
    label: msg('Retail'),
    title: msg('Shop till|menu'),
    items: [
      { label: msg('Point of sale|menu'), href: '/pos', icon: Store, perm: 'pos.read', keywords: ['pos', 'till', 'cashier', 'arka', 'z-report', 'register'] },
      { label: msg('Safe|nav'), href: '/safe', icon: Vault, perm: 'pos.approve|finance.read', keywords: ['sefi', 'sef', 'kasaforta', 'cash', 'deposit', 'derdhje', 'para', 'count'] },
      { label: msg('Loyalty cards'), href: '/pos/loyalty', icon: BadgePercent, perm: 'pos.read', keywords: ['kartela', 'zbritje', 'loyalty', 'points', 'pikë', 'besnikëri', 'discount card'] },
      { label: msg('Waiters'), href: '/pos/waiters', icon: UsersRound, perm: 'pos.read', keywords: ['kamarier', 'kamarierët', 'waiter', 'restaurant', 'tavolina', 'report'] },
      { label: msg('Recipes'), href: '/manufacturing/boms', icon: Layers, perm: 'manufacturing.read', keywords: ['receta', 'recipe', 'kit', 'ingredients', 'përbërës', 'kafe', 'restorant'] },
    ],
  },
  {
    // buying: orders, supplier invoices and the suppliers
    label: msg('Buy|menu'),
    items: [
      { label: msg('Vendor bills'), href: '/procurement/bills', icon: FileCheck2, perm: 'invoicing.read', group: msg('Documents'), keywords: ['bill', 'ap', 'payable', 'three-way match', 'faturë blerje'] },
      { label: msg('Purchase orders'), href: '/procurement/orders', icon: ShoppingCart, perm: 'procurement.read', keywords: ['po', 'buy', 'order', 'porosi blerje'] },
      { label: msg('Invoice from a photo|menu'), href: '/inventory/read-invoice', icon: ScanText, perm: 'inventory.read', keywords: ['ocr', 'scan', 'photo', 'foto', 'fatura', 'ai', 'pdf'] },
      { label: msg('Landed costs|menu'), href: '/inventory/landed-costs', icon: Ship, perm: 'procurement.read', keywords: ['customs', 'freight', 'import', 'clearance'] },
      { label: msg('Vendors'), href: '/partners?role=vendor', icon: Handshake, perm: 'partners.read', group: msg('Suppliers'), keywords: ['suppliers', 'furnitor'], focus: ['procurement.write', 'wms.write'] },
      { label: msg('Vendor prices'), href: '/procurement/vendor-prices', icon: BadgeEuro, perm: 'procurement.read', keywords: ['vendor price list', 'supplier prices', 'lead time', 'moq'] },
      { label: msg('Replenishment|menu'), href: '/procurement/replenishment', icon: RefreshCw, perm: 'procurement.read', group: msg('Planning'), keywords: ['reorder', 'mrp', 'suggestions', 'restock'] },
      { label: msg('Requisitions|menu'), href: '/procurement/requisitions', icon: ClipboardList, perm: 'requisitions.read', keywords: ['request', 'purchase request', 'pr', 'kërkesë'] },
    ],
  },
  {
    // the goods: what there is, what came in and went out
    label: msg('Inventory|menu'),
    items: [
      { label: msg('Products'), href: '/inventory/products', icon: Boxes, perm: 'inventory.read', group: msg('Items'), keywords: ['items', 'sku', 'variants', 'barcode'], focus: ['sales.write', 'wms.write'] },
      { label: msg('Stock levels'), href: '/inventory/stock', icon: PackageSearch, perm: 'inventory.read', keywords: ['on hand', 'available', 'reserved', 'valuation'], focus: ['sales.write', 'wms.write', 'pos.write'] },
      { label: msg('Item card'), href: '/inventory/item-card', icon: FileStack, perm: 'inventory.read', keywords: ['kartela', 'kartela e artikullit', 'item ledger', 'stock card', 'lëvizjet', 'movements', 'ledger', 'history'], focus: ['wms.write'] },
      { label: msg('Low stock|menu'), href: '/inventory/alerts', icon: TriangleAlert, perm: 'inventory.read', keywords: ['reorder', 'alerts', 'replenish'] },
      { label: msg('Lots & expiry|menu'), href: '/wms/lots', icon: Hourglass, perm: 'inventory.read', keywords: ['batch', 'serial', 'traceability', 'recall', 'fefo', 'expiry'] },
      { label: msg('Goods receipts|menu'), href: '/inventory/receipts', icon: PackageCheck, perm: 'inventory.read', group: msg('Goods in and out'), keywords: ['grn', 'receive', 'import'] },
      { label: msg('Transfers'), href: '/inventory/transfers', icon: ArrowLeftRight, perm: 'inventory.read', keywords: ['move', 'warehouse'] },
      { label: msg('Adjustments'), href: '/inventory/adjustments', icon: SlidersHorizontal, perm: 'inventory.read', keywords: ['opening', 'write-off', 'damage'] },
      { label: msg('Cycle counts|menu'), href: '/wms/counts', icon: ClipboardCheck, perm: 'wms.read', keywords: ['inventory count', 'stocktake', 'inventarizim', 'inventarizimi', 'numërimi', 'regjistrimi i mallit'] },
      { label: msg('Price levelling'), href: '/inventory/levelling', icon: ArrowUpDown, perm: 'inventory.read', group: msg('Prices and labels'), keywords: ['nivelim', 'nivelimi', 'nivelimi i cmimeve', 'ndryshim cmimi', 'price change', 'repricing', 'çmimet e reja', 'new selling prices', 'margin', 'markup', 'cost', 'marzh', 'cmim'] },
      { label: msg('Labels'), href: '/inventory/labels', icon: Tag, perm: 'inventory.read', keywords: ['etiketa', 'etiketat', 'barkod', 'barcode', 'shelf', 'raft', 'çmim', 'printo'] },
      { label: msg('Warehouses'), href: '/inventory/warehouses', icon: Warehouse, perm: 'inventory.read', group: msg('Setup|group'), keywords: ['locations', 'bins'] },
      { label: msg('Inventory setup|menu'), href: '/inventory/setup', icon: FolderTree, perm: 'inventory.read', keywords: ['categories', 'units', 'attributes'] },
    ],
  },
  {
    // money in and out: payments, debts, bank and cash
    label: msg('Money'),
    items: [
      { label: msg('Payments|menu'), href: '/finance/payments', icon: CircleDollarSign, perm: 'invoicing.read', keywords: ['receipts', 'pay', 'arkëtim', 'pagesë'] },
      { label: msg('Receivables|menu'), href: '/finance/receivables', icon: ArrowDownLeft, perm: 'invoicing.read', keywords: ['ar', 'aging', 'debtors', 'overdue', 'bilanci i subjekteve', 'saldo', 'borxhet', 'kush më ka borxh'] },
      { label: msg('Payables|menu'), href: '/finance/payables', icon: ArrowUpRight, perm: 'invoicing.read', keywords: ['ap', 'aging', 'creditors', 'due'] },
      { label: msg('Expenses'), href: '/finance/expenses', icon: ReceiptText, perm: 'invoicing.read', keywords: ['shpenzime', 'shpenzim', 'karburant', 'naftë', 'rryma', 'kupon', 'faturë', 'foto', 'receipt', 'fuel', 'expense'] },
      { label: msg('Bank and cash'), href: '/finance/bank', icon: Landmark, perm: 'finance.read', keywords: ['reconciliation', 'statement', 'banka'] },
      { label: msg('Cash book|ledger'), href: '/finance/cash-book', icon: Coins, perm: 'finance.read', keywords: ['libri i arkës', 'arka', 'cash book', 'para në dorë'] },
      { label: msg('Partner cards|menu'), href: '/finance/cards', icon: BookUser, perm: 'invoicing.read', keywords: ['kartela', 'kartela e klientit', 'kartela e furnitorit', 'ios', 'konfirmim', 'statement', 'saldo'] },
      { label: msg('Compensations'), href: '/finance/compensations', icon: Combine, perm: 'invoicing.read', keywords: ['kompensim', 'kompensimi', 'offset', 'netting'] },
    ],
  },
  {
    // VAT and the books for the tax office
    label: msg('Taxes and books'),
    items: [
      { label: msg('Sales book'), href: '/tax/books', icon: FileOutput, perm: 'tax.read', group: msg('Books and declarations'), keywords: ['libri i shitjes', 'libri i shitjeve', 'sales book', 'vat book', 'tvsh'] },
      { label: msg('Purchase book'), href: '/tax/books?book=purchase', icon: FileInput, perm: 'tax.read', keywords: ['libri i blerjes', 'libri i blerjeve', 'purchase book', 'vat book', 'tvsh'] },
      { label: msg('VAT declarations'), href: '/tax/declarations', icon: ClipboardPen, perm: 'tax.read', keywords: ['vat return', 'deklarata', 'tvsh', 'dpt', 'atk'] },
      { label: msg('Small business tax'), href: '/tax/small-business', icon: BadgePercent, perm: 'tax.read', keywords: ['biznes i vogël', 'biznes i vogel', '3%', '9%', 'tremujor', 'qarkullim', 'small business', 'turnover tax'] },
      { label: msg('Z reports'), href: '/finance/z-reports', icon: Printer, perm: 'invoicing.read', keywords: ['z raport', 'z-raporti', 'raporti z', 'arka fiskale', 'kasa', 'fiscal register', 'z report'] },
      { label: msg('Withholding tax'), href: '/tax/withholding', icon: HandCoins, perm: 'tax.read', group: msg('Other taxes'), keywords: ['tatim në burim', 'tatimi në burim', 'withholding', 'qira', 'rent', 'wht'] },
      { label: msg('Corporate income tax'), href: '/tax/income-tax', icon: PieChart, perm: 'tax.read', keywords: ['tatimi mbi fitimin', 'tatim fitimi', 'cit', 'profit tax', 'deklarata vjetore'] },
      { label: msg('Fiscalization'), href: '/tax/fiscalization', icon: Fingerprint, perm: 'tax.read', keywords: ['nivf', 'nslf', 'iic', 'fic', 'cis', 'efiskalizimi', 'qr'] },
      { label: msg('Tax codes|menu'), href: '/tax/codes', icon: Percent, perm: 'tax.read', keywords: ['vat rates', 'exempt', 'reverse charge'] },
    ],
  },
  {
    // the accountant's part
    label: msg('Accounting'),
    items: [
      { label: msg('Books check'), href: '/check', icon: ShieldCheck, perm: 'invoicing.read', keywords: ['kontrolli', 'gabime', 'gabimet', 'mistakes', 'check', 'kujdestari', 'pa faturë', 'minus', 'nui'] },
      { label: msg('Financial statements'), href: '/finance/reports', icon: BarChart3, perm: 'finance.read', keywords: ['p&l', 'profit and loss', 'balance sheet', 'cash flow', 'trial balance', 'bilanc', 'comparison'] },
      { label: msg('Journal entries|menu'), href: '/finance/journal', icon: BookOpen, perm: 'finance.read', keywords: ['gl', 'general ledger', 'manual entry', 'ditar'] },
      { label: msg('Account card'), href: '/finance/account-card', icon: NotebookTabs, perm: 'finance.read', keywords: ['kartela e kontos', 'libri kryesor', 'general ledger', 'account ledger'] },
      { label: msg('Chart of accounts'), href: '/finance/accounts', icon: ListTree, perm: 'finance.read', keywords: ['coa', 'ledger', 'plan kontabel', 'accounts'] },
      { label: msg('Fixed assets|menu'), href: '/finance/assets', icon: Building, perm: 'finance.read', keywords: ['depreciation', 'amortization', 'aktive'] },
      { label: msg('Assets from invoices'), href: '/finance/asset-invoices', icon: FileScan, perm: 'finance.read', keywords: ['mjete themelore', 'faturë', 'foto', 'investim', 'veturë', 'kompjuter', 'asset invoice'] },
      { label: msg('Cost centers|menu'), href: '/finance/cost-centers', icon: Network, perm: 'finance.read', keywords: ['departments', 'branches', 'projects'] },
      { label: msg('Year-end close'), href: '/finance/year-end', icon: CalendarCheck, perm: 'finance.read', keywords: ['mbyllja e vitit', 'mbyllje', 'year end', 'closing', 'fitimi i vitit', '109', '108'] },
      { label: msg('Finance setup'), href: '/finance/setup', icon: Settings2, perm: 'finance.read', keywords: ['posting accounts', 'periods', 'close', 'fiscal year', 'journals'] },
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
      { label: msg('Reservations'), href: '/hotel/reservations', icon: CalendarPlus, perm: 'sales.read', keywords: ['rezervim', 'rezervime', 'booking', 'guest', 'mysafir', 'klient'] },
      { label: msg('Rooms'), href: '/hotel/rooms', icon: BedDouble, perm: 'sales.read', keywords: ['dhoma', 'housekeeping', 'pastrim', 'room types', 'çmime'] },
    ],
  },
  {
    label: msg('Manufacturing'),
    items: [
      { label: msg('Production overview'), href: '/manufacturing', icon: Activity, perm: 'manufacturing.read', keywords: ['production', 'mrp', 'plan', 'prodhim', 'capacity'] },
      { label: msg('Work orders|menu'), href: '/manufacturing/orders', icon: Factory, perm: 'manufacturing.read', keywords: ['wo', 'production order', 'manufacturing order', 'urdhër pune'] },
      { label: msg('Bills of materials'), href: '/manufacturing/boms', also: true, icon: Layers, perm: 'manufacturing.read', keywords: ['receta', 'recipe', 'kit', 'ingredients', 'përbërës', 'kafe', 'restorant'] },
      { label: msg('Work centers|menu'), href: '/manufacturing/work-centers', icon: Cog, perm: 'manufacturing.read', keywords: ['machines', 'lines', 'capacity', 'rates'] },
    ],
  },
  {
    label: msg('Logistics'),
    title: msg('Logistics|menu'),
    items: [
      { label: msg('Logistics overview'), href: '/logistics', icon: Map, perm: 'logistics.read', keywords: ['transport', 'fleet', 'kpi', 'transport'] },
      { label: msg('Delivery planning'), href: '/logistics/planning', icon: MapPinned, perm: 'logistics.read', keywords: ['routes', 'dispatch', 'vans', 'drivers', 'plan'] },
      { label: msg('Shipments'), href: '/logistics/shipments', icon: Route, perm: 'logistics.read', keywords: ['tracking', 'carrier', 'cod', 'cash on delivery', 'dërgesa'] },
      { label: msg('Carriers and fleet'), href: '/logistics/setup', icon: PackageDone, perm: 'logistics.read', keywords: ['vehicles', 'carriers', 'vans', 'courier'] },
    ],
  },
  {
    label: msg('Warehouse|menu'),
    items: [
      { label: msg('Warehouse floor'), href: '/wms', icon: ScanLine, perm: 'wms.read', keywords: ['wms', 'scanner', 'handheld', 'magazina'] },
      { label: msg('Receive'), href: '/wms/receive', icon: ScanBarcode, perm: 'wms.read', keywords: ['receiving', 'dock', 'grn', 'scan in'] },
      { label: msg('Put away'), href: '/wms/putaway', icon: PackageOpen, perm: 'wms.read', keywords: ['putaway', 'bins', 'storage'] },
      { label: msg('Pick'), href: '/wms/picking', icon: ShoppingBasket, perm: 'wms.read', keywords: ['picking', 'pick list', 'orders'] },
      { label: msg('Ship'), href: '/wms/shipping', icon: Send, perm: 'wms.read', keywords: ['shipping', 'dispatch', 'tracking', 'carrier'] },
      { label: msg('Move stock'), href: '/wms/move', icon: Move, perm: 'wms.read', keywords: ['bin to bin', 'relocate', 'internal transfer'] },
    ],
  },
  {
    label: msg('People'),
    title: msg('People|menu'),
    items: [
      { label: msg('People overview'), href: '/hr', icon: UsersRound, perm: 'hr.read', keywords: ['hr', 'headcount', 'burime njerëzore'] },
      { label: msg('Employees|menu'), href: '/hr/employees', icon: Contact, perm: 'hr.read', keywords: ['staff', 'punonjës', 'contracts'] },
      { label: msg('Leave'), href: '/hr/leave', icon: CalendarDays, perm: 'hr.read', keywords: ['holiday', 'vacation', 'pushime', 'absence', 'sick'] },
      { label: msg('Attendance'), href: '/hr/attendance', icon: Clock, perm: 'hr.read', keywords: ['timesheet', 'clock in', 'prezenca', 'overtime'] },
      { label: msg('Payroll'), href: '/hr/payroll', icon: Banknote, perm: 'payroll.read', keywords: ['salaries', 'payslips', 'listëpagesa', 'tap', 'contributions', 'paga'] },
      { label: msg('My workplace'), href: '/hr/me', icon: UserRound, perm: 'core.read', keywords: ['my leave', 'my payslips', 'clock in', 'self-service'], always: true },
    ],
  },
  {
    // the numbers, in one place
    label: msg('Reports|menu'),
    items: [
      { label: msg('Reports'), href: '/reports', icon: FileBarChart, perm: 'reports.read', keywords: ['analytics', 'sales analysis', 'margin', 'valuation', 'aging', 'raporte'] },
      { label: msg('Sales overview|menu'), href: '/sales', icon: BadgeDollarSign, perm: 'sales.read', keywords: ['revenue', 'kpi', 'performance', 'metrics'] },
      { label: msg('Purchasing overview|menu'), href: '/procurement', icon: LineChart, perm: 'procurement.read', keywords: ['spend', 'procurement', 'kpi', 'blerje'] },
      { label: msg('Finance overview|menu'), href: '/finance', icon: Landmark, perm: 'finance.read', keywords: ['accounting', 'kpi', 'kontabilitet'] },
      { label: msg('Tax overview|menu'), href: '/tax', icon: Scale, perm: 'tax.read', keywords: ['vat', 'tvsh', 'calendar', 'deadlines', 'tatime'] },
      { label: msg('History from the old program'), href: '/history', icon: Archive, perm: 'invoicing.read', keywords: ['historiku', 'logmicro', 'arkiv', 'archive', 'old program', 'kubit', 'bilanc'] },
    ],
  },
  {
    // settings: company, people, numbering, links
    label: msg('Company'),
    title: msg('Settings|menu'),
    items: [
      { label: msg('Company settings|menu'), href: '/settings', icon: Building2, perm: 'admin.read', keywords: ['profile', 'nipt', 'fiscal codes', 'preferences'] },
      { label: msg('Users and roles'), href: '/settings/users', icon: KeyRound, perm: 'admin.read', keywords: ['invite', 'members', 'permissions', 'roles', 'access', 'security', 'siguria', 'permission matrix', 'custom role'] },
      { label: msg('Numbering'), href: '/settings/numbering', icon: ListOrdered, perm: 'admin.read', keywords: ['sequences', 'prefix', 'document numbers'] },
      { label: msg('Automations'), href: '/settings/automation', icon: Zap, perm: 'core.read', keywords: ['automatic', 'schedule', 'automatizim', 'email', 'whatsapp', 'reminders'] },
      { label: msg('Approval workflows|menu'), href: '/settings/workflows', icon: Workflow, perm: 'admin.read', keywords: ['approval limits', 'approvers'] },
      { label: msg('Import data'), href: '/settings/import', icon: Import, perm: 'core.read', keywords: ['csv', 'excel', 'upload', 'migration', 'opening balances'] },
      { label: msg('Move from another program'), href: '/settings/migration', icon: ArrowDownToLine, perm: 'admin.write', keywords: ['migration', 'kubit', 'logmicro', 'bilanc', 'pantheon', 'opening balances', 'cut-over', 'kalimi', 'migrimi'] },
      { label: msg('B2B portal and API|menu'), href: '/settings/integrations', icon: Plug, perm: 'admin.read', keywords: ['api', 'b2b', 'portal', 'portali', 'web shop', 'dyqan online', 'integrim', 'key', 'çelës', 'woocommerce', 'shopify', 'chatgpt', 'claude', 'mcp', 'ai'] },
      { label: msg('Audit log|menu'), href: '/settings/audit', icon: History, perm: 'audit.read', keywords: ['history', 'changes', 'who changed'] },
    ],
  },
]
