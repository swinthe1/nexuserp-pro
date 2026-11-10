import {
  Bell, Printer, CalendarDays, CalendarClock, ClipboardPen, Contact, FileBarChart, Fingerprint, Globe, History, Import, KeyRound, Archive, ListOrdered,
  MapPinned, PackageCheck as PackageDone, Route, ShieldCheck, UserRound, UsersRound, Workflow, Zap,
  BadgePercent, Calculator, ClipboardCheck, Hourglass, PackageOpen, ScanLine, ShoppingBasket,
  ArrowDownToLine, ArrowLeftRight, BadgeDollarSign, Cog, Layers, Banknote, Building, HandCoins, ListTree, Network, Settings2, BarChart3, Boxes, Building2, ClipboardList, Factory, FileCheck2, FileStack, FileText, 
  Kanban, Landmark, LayoutDashboard, Magnet, PackageCheck, PackageSearch, Receipt, RefreshCw, Scale, Ship, ShoppingBag, ShoppingCart,
  BedDouble, BookUser, CalendarRange, ConciergeBell, Repeat, ScanText, SlidersHorizontal, Store, Tag, Tags, Ticket, CalendarCheck, Percent, Truck, TriangleAlert, Users, Vault, Warehouse, Smartphone, Plug, ReceiptText, IdCard, Settings, CreditCard, type LucideIcon, Activity, ArrowUpDown, BadgeEuro, BookOpen, CalendarPlus, CheckCheck, CircleDollarSign, Clock, Coins, Combine, FileScan, FolderTree, Gift, Handshake, LineChart, Map, Move, NotebookTabs, PieChart, ScanBarcode, Send, ListChecks, ChartSpline, PackageMinus, GraduationCap,
  FileSignature, ListTodo, ScanSearch, Grid3x3, Gauge, Award, Gavel, Brain, FolderDown, MessageSquare, Trash2, Shuffle, Weight, ShieldAlert } from 'lucide-react'
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
  /** a heading in the classic menu bar: the entry (hub) the page belongs to */
  group?: string
  /** found by the page search, but not listed in the side menu (it has its own place, e.g. the bell) */
  hideInMenu?: boolean
  /** other addresses that belong to this entry (the debts page has two tabs) */
  match?: string[]
  /** pages that do one kind of work share one entry in the menu and show as tabs at the top of each of them */
  hub?: string
  /** the part of the menu it came from, when that part was joined to another (a company may still switch it off) */
  part?: string
}
/** label: the part's key (also what a company switches off); title: what the menu shows, when it differs */
export interface NavSection { label: string; title?: string; items: NavItem[] }

export const NAV: NavSection[] = [
  {
    // the start page and what waits for me
    label: msg('Overview'),
    items: [
      { label: msg('Dashboard'), href: '/', icon: LayoutDashboard, perm: 'core.read', keywords: ['home', 'kpi'], always: true, hub: msg('Dashboard') },
      { label: msg('Approvals|menu'), href: '/approvals', icon: CheckCheck, perm: 'core.read', keywords: ['approve', 'pending', 'inbox'], hub: msg('Dashboard') },
      { label: msg('Tasks|menu'), href: '/tasks', icon: ListTodo, perm: 'core.read', keywords: ['detyrat', 'detyrë', 'punët', 'to do', 'todo', 'lista', 'kujtesa', 'projekt', 'task', 'kanban'], hub: msg('Dashboard') },
      { label: msg('Training|menu'), href: '/training', icon: GraduationCap, perm: 'core.read', keywords: ['trajnimi', 'trajnim', 'mësime', 'udhëzime', 'si punon', 'ndihmë', 'help', 'tutorial', 'learn'], hub: msg('Dashboard') },
      { label: msg('Chat'), href: '/chat', icon: MessageSquare, perm: 'core.read', hideInMenu: true, keywords: ['chat', 'biseda', 'mesazhe', 'mesazh', 'shkruaj', 'grup', 'teams', 'slack', 'whatsapp', 'kolegët'] },
      { label: msg('My exports'), href: '/exports', icon: FolderDown, perm: 'core.read', hideInMenu: true, keywords: ['eksportet', 'eksporti', 'shkarkimet', 'excel', 'pdf', 'csv', 'downloads', 'skedarët'] },
      { label: msg('My clients'), href: '/accountant', icon: BookOpen, perm: 'core.read', hideInMenu: true, keywords: ['kontabilisti', 'kontabilist', 'accountant', 'klientët e kontabilistit', 'zyra e kontabilitetit'] },
      { label: msg('Notifications'), href: '/notifications', icon: Bell, perm: 'core.read', keywords: ['alerts', 'inbox', 'reminders', 'njoftime'], always: true, hideInMenu: true },
    ],
  },
  {
    // the goods: items, stock, movements, counts, the scanner
    label: msg('Inventory|menu'),
    title: msg('Stock and items|menu'),
    items: [
      { label: msg('Products'), href: '/inventory/products', icon: Boxes, perm: 'inventory.read', keywords: ['items', 'sku', 'variants', 'barcode'], focus: ['sales.write', 'wms.write'], hub: msg('Items|menu') },
      { label: msg('Check item|menu'), href: '/inventory/check', icon: ScanSearch, perm: 'inventory.read', keywords: ['zebra', 'scanner', 'skano', 'kontrollo', 'ku ka', 'where is', 'stock in stores', 'njësitë', 'dyqanet', 'gjendja', 'transfer'], focus: ['inventory.write', 'wms.write', 'pos.write'], hub: msg('Items|menu') },
      { label: msg('Item card'), href: '/inventory/item-card', icon: FileStack, perm: 'inventory.read', keywords: ['kartela', 'kartela e artikullit', 'item ledger', 'stock card', 'lëvizjet', 'movements', 'ledger', 'history'], focus: ['wms.write'], hub: msg('Items|menu') },
      { label: msg('Labels'), href: '/inventory/labels', icon: Tag, perm: 'inventory.read', keywords: ['etiketa', 'etiketat', 'barkod', 'barcode', 'shelf', 'raft', 'çmim', 'printo'], hub: msg('Items|menu') },
      { label: msg('ABC-XYZ classification|menu'), href: '/inventory/abc', icon: Grid3x3, perm: 'inventory.read', keywords: ['abc', 'xyz', 'pareto', 'klasifikimi', 'kategorizimi', 'klasa', 'analiza abc', 'dead stock', 'pa lëvizje', 'mall i ndenjur'], focus: ['inventory.write', 'procurement.write'], hub: msg('Items|menu') },
      { label: msg('Stock levels'), href: '/inventory/stock', icon: PackageSearch, perm: 'inventory.read', keywords: ['on hand', 'available', 'reserved', 'valuation'], focus: ['sales.write', 'wms.write', 'pos.write'], hub: msg('Stock|menu') },
      { label: msg('Stock report|menu'), href: '/inventory/stock-report', icon: BarChart3, perm: 'inventory.read', keywords: ['raporti i stokut', 'gjendja', 'cmime mesatare', 'çmime mesatare', 'cmimore', 'çmimore', 'fletengarkese', 'fletëngarkesë', 'prodhuesi', 'valuation', 'stock on date', 'inventory value'], hub: msg('Stock|menu') },
      { label: msg('Low stock|menu'), href: '/inventory/alerts', icon: TriangleAlert, perm: 'inventory.read', keywords: ['reorder', 'alerts', 'replenish'], hub: msg('Stock|menu') },
      { label: msg('Short dates|menu'), href: '/inventory/expiry', icon: CalendarClock, perm: 'inventory.read', keywords: ['afat', 'afati', 'skadenca', 'skadim', 'zbritje', 'expiry', 'short date', 'markdown', 'fefo'], hub: msg('Losses and expiry|menu') },
      { label: msg('Lot tracing|menu'), href: '/wms/lots', icon: Hourglass, perm: 'inventory.read', keywords: ['batch', 'serial', 'traceability', 'recall', 'fefo', 'expiry'], hub: msg('Losses and expiry|menu') },
      { label: msg('Loss watch|menu'), href: '/inventory/loss-watch', icon: ShieldAlert, perm: 'pos.approve', keywords: ['detektori', 'detektori i humbjeve', 'humbje', 'vjedhje', 'anulime', 'kthime pa kupon', 'zbritje', 'mungesë në arkë', 'kamarier', 'loss prevention', 'theft', 'fraud'], hub: msg('Losses and expiry|menu') },
      { label: msg('Shrinkage|menu'), href: '/inventory/shrinkage', icon: PackageMinus, perm: 'inventory.read', keywords: ['humbje', 'firo', 'vjedhje', 'dëmtim', 'skadim', 'mungesa', 'shrinkage', 'loss', 'theft'], hub: msg('Losses and expiry|menu') },
      { label: msg('Stock outputs|menu'), href: '/inventory/outputs', icon: PackageMinus, perm: 'inventory.read', keywords: ['dalje', 'daljet', 'hedhje', 'hedhjet', 'pemë', 'perime', 'shpenzim i brendshëm', 'outputs', 'waste', 'write-off'], hub: msg('Losses and expiry|menu') },
      { label: msg('Fruit and vegetables thrown away|menu'), href: '/inventory/waste', icon: Trash2, perm: 'inventory.read', keywords: ['hedhje', 'hedhjet', 'pemë', 'perime', 'fruta', 'prishen', 'waste', 'shrink', '% e hedhjes'], hub: msg('Losses and expiry|menu') },
      { label: msg('Cycle counts|menu'), href: '/wms/counts', icon: ClipboardCheck, perm: 'wms.read', keywords: ['inventory count', 'stocktake', 'inventarizim', 'inventarizimi', 'numërimi', 'regjistrimi i mallit'] },
      { label: msg('Warehouse floor'), href: '/wms', icon: ScanLine, perm: 'wms.read', keywords: ['wms', 'scanner', 'handheld', 'magazina'], hub: msg('Scanner|menu'), part: msg('Warehouse|menu') },
      { label: msg('Receive'), href: '/wms/receive', icon: ScanBarcode, perm: 'wms.read', keywords: ['receiving', 'dock', 'grn', 'scan in'], hub: msg('Scanner|menu'), part: msg('Warehouse|menu') },
      { label: msg('Put away'), href: '/wms/putaway', icon: PackageOpen, perm: 'wms.read', keywords: ['putaway', 'bins', 'storage'], hub: msg('Scanner|menu'), part: msg('Warehouse|menu') },
      { label: msg('Pick'), href: '/wms/picking', icon: ShoppingBasket, perm: 'wms.read', keywords: ['picking', 'pick list', 'orders'], hub: msg('Scanner|menu'), part: msg('Warehouse|menu') },
      { label: msg('Ship'), href: '/wms/shipping', icon: Send, perm: 'wms.read', keywords: ['shipping', 'dispatch', 'tracking', 'carrier'], hub: msg('Scanner|menu'), part: msg('Warehouse|menu') },
      { label: msg('Move stock'), href: '/wms/move', icon: Move, perm: 'wms.read', keywords: ['bin to bin', 'relocate', 'internal transfer'], hub: msg('Scanner|menu'), part: msg('Warehouse|menu') },
      { label: msg('Thrown away|scanner'), href: '/wms/waste', icon: Trash2, perm: 'wms.read', keywords: ['hedhje', 'hedhjet', 'pemë', 'perime', 'zebra', 'peshim', 'waste'], hub: msg('Scanner|menu'), part: msg('Warehouse|menu') },
      { label: msg('Warehouses|menu'), href: '/inventory/warehouses', icon: Warehouse, perm: 'inventory.read', keywords: ['locations', 'bins', 'magazinat', 'magazina', 'dyqanet', 'depot', 'njësitë', 'pikat'], hub: msg('Warehouses and setup|menu') },
      { label: msg('Inventory setup|menu'), href: '/inventory/setup', icon: FolderTree, perm: 'inventory.read', keywords: ['categories', 'units', 'attributes'], hub: msg('Warehouses and setup|menu') },
    ],
  },
  {
    // buying: documents, suppliers, planning
    label: msg('Buy|menu'),
    items: [
      { label: msg('Vendor bills'), href: '/procurement/bills', match: ['/procurement/invoice'], icon: FileCheck2, perm: 'invoicing.read', keywords: ['bill', 'ap', 'payable', 'three-way match', 'faturë blerje', 'libri i blerjeve', 'libri i mallit', 'libri i shpenzimeve', 'libri i investimeve', 'investime'], hub: msg('Purchase documents|menu') },
      { label: msg('Purchase orders'), href: '/procurement/orders', icon: ShoppingCart, perm: 'procurement.read', keywords: ['po', 'buy', 'order', 'porosi blerje'], hub: msg('Purchase documents|menu') },
      { label: msg('Goods receipts|menu'), href: '/inventory/receipts', icon: PackageCheck, perm: 'inventory.read', keywords: ['grn', 'receive', 'import'], hub: msg('Purchase documents|menu') },
      { label: msg('Goods waiting for the invoice|menu'), href: '/procurement/pending-invoices', icon: Hourglass, perm: 'procurement.read', keywords: ['pa faturë', 'mall pa faturë', 'pranim pa faturë', 'fletëdërgesë', 'në pritje të faturës', '4081', 'grni', 'goods received not invoiced', 'pending invoice'], hub: msg('Purchase documents|menu') },
      { label: msg('Invoice from a photo|menu'), href: '/inventory/read-invoice', icon: ScanText, perm: 'inventory.read', keywords: ['ocr', 'scan', 'photo', 'foto', 'fatura', 'ai', 'pdf'], hub: msg('Purchase documents|menu') },
      { label: msg('Landed costs|menu'), href: '/inventory/landed-costs', icon: Ship, perm: 'procurement.read', keywords: ['customs', 'freight', 'import', 'clearance'], hub: msg('Purchase documents|menu') },
      { label: msg('Vendors'), href: '/partners?role=vendor', icon: Handshake, perm: 'partners.read', keywords: ['suppliers', 'furnitor'], focus: ['procurement.write', 'wms.write'], hub: msg('Suppliers|menu') },
      { label: msg('Vendor prices'), href: '/procurement/vendor-prices', icon: BadgeEuro, perm: 'procurement.read', keywords: ['vendor price list', 'supplier prices', 'lead time', 'moq'], hub: msg('Suppliers|menu') },
      { label: msg('Supplier contracts|menu'), href: '/procurement/contracts', icon: FileSignature, perm: 'procurement.read', keywords: ['kontrata', 'kontratat', 'marrëveshje', 'rabat', 'afati i pagesës', 'contract', 'agreement'], hub: msg('Suppliers|menu') },
      { label: msg('Vendor scorecard|menu'), href: '/procurement/scorecard', icon: Award, perm: 'procurement.read', keywords: ['scorecard', 'karta', 'vlerësimi', 'furnitor', 'on time', 'në kohë', 'vonesa', 'supplier rating', 'performance'], hub: msg('Suppliers|menu') },
      { label: msg('Replenishment|menu'), href: '/procurement/replenishment', icon: RefreshCw, perm: 'procurement.read', keywords: ['reorder', 'mrp', 'suggestions', 'restock'], hub: msg('Purchase planning|menu') },
      { label: msg('Requisitions|menu'), href: '/procurement/requisitions', icon: ClipboardList, perm: 'requisitions.read', keywords: ['request', 'purchase request', 'pr', 'kërkesë'], hub: msg('Purchase planning|menu') },
      { label: msg('Offers from vendors|menu'), href: '/procurement/rfqs', icon: Gavel, perm: 'procurement.read', keywords: ['rfq', 'oferta', 'ofertë', 'tender', 'krahasim', 'quotation', 'compare offers', 'kërkesë për ofertë'], hub: msg('Purchase planning|menu') },
    ],
  },
  {
    // selling: documents, customers, prices, agents, online
    label: msg('Sell|menu'),
    items: [
      { label: msg('Customer invoices'), href: '/sales/invoices', icon: Receipt, perm: 'invoicing.read', keywords: ['invoice', 'fatura', 'credit note', 'billing'], hub: msg('Sales documents|menu') },
      { label: msg('Quotes'), href: '/sales/quotes', icon: FileText, perm: 'sales.read', keywords: ['offer', 'proposal', 'estimate', 'oferta'], hub: msg('Sales documents|menu') },
      { label: msg('Sales orders'), href: '/sales/orders', icon: ShoppingBag, perm: 'sales.read', keywords: ['so', 'orders', 'porosi'], hub: msg('Sales documents|menu') },
      { label: msg('Deliveries'), href: '/sales/deliveries', icon: Truck, perm: 'sales.read', keywords: ['shipping', 'dispatch', 'flete'], hub: msg('Sales documents|menu') },
      { label: msg('Recurring invoices'), href: '/sales/recurring', icon: Repeat, perm: 'invoicing.read', keywords: ['rent', 'subscription', 'qira', 'abonim', 'monthly'], hub: msg('Sales documents|menu') },
      { label: msg('Customers'), href: '/partners?role=customer', icon: Users, perm: 'partners.read', keywords: ['clients', 'partners', 'vendors', 'klient'], focus: ['sales.write', 'pos.write'], hub: msg('Customers|menu') },
      { label: msg('Leads'), href: '/crm/leads', icon: Magnet, perm: 'crm.read', keywords: ['prospects', 'enquiries', 'crm'], hub: msg('Customers|menu') },
      { label: msg('Pipeline|menu'), href: '/crm/pipeline', icon: Kanban, perm: 'crm.read', keywords: ['opportunities', 'deals', 'crm', 'kanban'], hub: msg('Customers|menu') },
      { label: msg('Price lists'), href: '/sales/price-lists', icon: Tags, perm: 'sales.read', keywords: ['pricing', 'wholesale', 'retail', 'discount'], hub: msg('Prices and promotions|menu') },
      { label: msg('Promotions'), href: '/sales/promotions', icon: Gift, perm: 'sales.read', keywords: ['promocion', 'promocione', 'aksion', 'zbritje', '3 me 2', 'offer', 'sale', 'happy hour'], hub: msg('Prices and promotions|menu') },
      { label: msg('Gift vouchers'), href: '/pos/vouchers', icon: Ticket, perm: 'pos.read', keywords: ['kupon dhurate', 'kuponë', 'voucher', 'gift card', 'dhuratë', 'vlerë'], hub: msg('Prices and promotions|menu') },
      { label: msg('Loyalty cards'), href: '/pos/loyalty', icon: BadgePercent, perm: 'pos.read', keywords: ['kartela', 'zbritje', 'loyalty', 'points', 'pikë', 'besnikëri', 'discount card'], hub: msg('Prices and promotions|menu') },
      { label: msg('Price levelling'), href: '/inventory/levelling', icon: ArrowUpDown, perm: 'inventory.read', keywords: ['nivelim', 'nivelimi', 'nivelimi i cmimeve', 'ndryshim cmimi', 'price change', 'repricing', 'çmimet e reja', 'new selling prices', 'margin', 'markup', 'cost', 'marzh', 'cmim'], hub: msg('Prices and promotions|menu') },
      { label: msg('Prices for the scale'), href: '/inventory/scale-prices', icon: Weight, perm: 'inventory.read', keywords: ['peshore', 'peshorja', 'plu', 'rongta', 'rls1000', 'rtplu', 'scale', 'cmimet te peshorja', 'etiketa e peshores'], hub: msg('Prices and promotions|menu') },
      { label: msg('Agent app'), href: '/agent', icon: Smartphone, perm: 'sales.write', keywords: ['agjent', 'terren', 'field', 'route', 'rruga', 'arkëtim', 'van', 'shitës', 'porosi'], hub: msg('Field sales|menu') },
      { label: msg('Field agents'), href: '/sales/agents', icon: MapPinned, perm: 'sales.approve', keywords: ['agjentët', 'terren', 'field sales', 'routes', 'visits', 'vizita', 'gps'], hub: msg('Field sales|menu') },
      { label: msg('Order desk|menu'), href: '/oms/fulfillment', icon: ListOrdered, perm: 'sales.read', keywords: ['oms', 'backorders', 'fulfilment', 'allocation', 'open orders', 'short'], hub: msg('Online|menu') },
      { label: msg('Web shop'), href: '/ecommerce', icon: Globe, perm: 'ecommerce.read', keywords: ['e-commerce', 'shopify', 'woocommerce', 'online orders', 'channels'], hub: msg('Online|menu') },
    ],
  },
  {
    // the shop or café till
    label: msg('Retail'),
    title: msg('Shop till|menu'),
    items: [
      { label: msg('Point of sale|menu'), href: '/pos', icon: Store, perm: 'pos.read', keywords: ['pos', 'till', 'cashier', 'arka', 'z-report', 'register'], hub: msg('Till|menu') },
      { label: msg('Till history|menu'), href: '/pos/history', icon: History, perm: 'pos.read', keywords: ['historiku', 'historik', 'raport arka', 'raporti i arkëtarit', 'arkëtarët', 'diferencat', 'hyrje dalje', 'anulimet', 'orët', 'raporti x', 'shift report', 'cashier report'], hub: msg('Till|menu') },
      { label: msg('Reconciling the tills|menu'), href: '/pos/review', icon: CheckCheck, perm: 'pos.approve', keywords: ['barazimi', 'barazim', 'barazo arkën', 'mbyllja e arkës', 'diferenca', 'numërimi', 'reconcile', 'cash count', 'shift close'], hub: msg('Till|menu') },
      { label: msg('Daily checks|menu'), href: '/pos/checks', icon: ClipboardCheck, perm: 'pos.read|wms.read', keywords: ['kontroll', 'kontrolli', 'checklist', 'listë kontrolli', 'higjiena', 'temperatura', 'frigorifer', 'hapja', 'mbyllja', 'hygiene', 'fridge'], hub: msg('Till|menu') },
      { label: msg('Safe|nav'), href: '/safe', icon: Vault, perm: 'pos.approve|finance.read', keywords: ['sefi', 'sef', 'kasaforta', 'cash', 'deposit', 'derdhje', 'para', 'count'], hub: msg('Till|menu') },
      { label: msg('Z reports'), href: '/finance/z-reports', icon: Printer, perm: 'invoicing.read', keywords: ['z raport', 'z-raporti', 'raporti z', 'arka fiskale', 'kasa', 'fiscal register', 'z report'], hub: msg('Till|menu') },
      { label: msg('Tills at ATK|menu'), href: '/pos/atk', icon: ShieldCheck, perm: 'pos.approve|tax.read', keywords: ['atk', 'fiskalizim', 'fiskal', 'kupon fiskal', 'certifikatë', 'certificate', 'qr', 'edi', 'kosova', 'softuer elektronik fiskal'], hub: msg('Till|menu') },
      { label: msg('Waiters'), href: '/pos/waiters', icon: UsersRound, perm: 'pos.read', keywords: ['kamarier', 'kamarierët', 'waiter', 'restaurant', 'tavolina', 'report'], hub: msg('Till|menu') },
    ],
  },
  {
    label: msg('Appointments'),
    items: [
      { label: msg('Appointment calendar'), href: '/appointments', icon: CalendarClock, perm: 'sales.read', keywords: ['termin', 'terminet', 'takim', 'rezervim', 'kalendar', 'booking', 'salon', 'klinikë', 'servis'], hub: msg('Appointments') },
      { label: msg('Client cards'), href: '/appointments/cards', icon: IdCard, perm: 'sales.read', keywords: ['kartela', 'pacient', 'automjet', 'targa', 'vetura', 'kafshë', 'historiku', 'vehicle', 'patient', 'pet'], hub: msg('Appointments') },
      { label: msg('Memberships'), href: '/appointments/memberships', icon: CreditCard, perm: 'sales.read', keywords: ['anëtarësim', 'abonim', 'palestër', 'gym', 'karta', 'hyrje', 'membership'], hub: msg('Appointments') },
      { label: msg('Services and staff'), href: '/appointments/setup', icon: Settings, perm: 'sales.read', keywords: ['shërbime', 'punëtorë', 'orari', 'karrige', 'ngritës'], hub: msg('Appointments') },
    ],
  },
  {
    label: msg('Hotel'),
    items: [
      { label: msg('Front desk'), href: '/hotel', icon: ConciergeBell, perm: 'sales.read', keywords: ['recepsion', 'reception', 'hotel', 'arrivals', 'mbërritje', 'check-in', 'check-out'], hub: msg('Hotel') },
      { label: msg('Room calendar'), href: '/hotel/calendar', icon: CalendarRange, perm: 'sales.read', keywords: ['kalendar', 'dhoma', 'rooms', 'availability', 'zënie', 'planner'], hub: msg('Hotel') },
      { label: msg('Reservations'), href: '/hotel/reservations', icon: CalendarPlus, perm: 'sales.read', keywords: ['rezervim', 'rezervime', 'booking', 'guest', 'mysafir', 'klient'], hub: msg('Hotel') },
      { label: msg('Rooms'), href: '/hotel/rooms', icon: BedDouble, perm: 'sales.read', keywords: ['dhoma', 'housekeeping', 'pastrim', 'room types', 'çmime'], hub: msg('Hotel') },
    ],
  },
  {
    // the goods moving inside the company: between units, balancing, corrections
    label: msg('Internal moves'),
    title: msg('Internal moves|menu'),
    items: [
      { label: msg('Transfers'), href: '/inventory/transfers', icon: ArrowLeftRight, perm: 'inventory.read', keywords: ['move', 'warehouse'], hub: msg('Internal moves|menu') },
      { label: msg('Stock balancing'), href: '/inventory/balancing', icon: Shuffle, perm: 'inventory.read', keywords: ['balancim', 'balancimi', 'rishpërndarje', 'mbistok', 'mungesë', 'rebalance', 'redistribute'], hub: msg('Internal moves|menu') },
      { label: msg('Adjustments'), href: '/inventory/adjustments', icon: SlidersHorizontal, perm: 'inventory.read', keywords: ['opening', 'write-off', 'damage'], hub: msg('Internal moves|menu') },
    ],
  },
  {
    // money in and out
    label: msg('Money'),
    items: [
      { label: msg('Payments|menu'), href: '/finance/payments', icon: CircleDollarSign, perm: 'invoicing.read', keywords: ['receipts', 'pay', 'arkëtim', 'pagesë'], hub: msg('Payments|hub') },
      { label: msg('Payment proposal'), href: '/finance/payment-proposal', icon: ListChecks, perm: 'invoicing.read', keywords: ['propozimi i pagesave', 'çka të paguaj', 'pagesat e furnitorëve', 'pay suppliers', 'payment run', 'zbritje', 'afati'], hub: msg('Payments|hub') },
      { label: msg('Compensations'), href: '/finance/compensations', icon: Combine, perm: 'invoicing.read', keywords: ['kompensim', 'kompensimi', 'offset', 'netting'], hub: msg('Payments|hub') },
      { label: msg('Debts|menu'), href: '/finance/receivables', match: ['/finance/payables'], icon: Scale, perm: 'invoicing.read', keywords: ['ar', 'aging', 'debtors', 'overdue', 'bilanci i subjekteve', 'saldo', 'borxhet', 'kush më ka borxh', 'ap', 'creditors', 'due', 'kujt i kam borxh', 'furnitorët', 'borxhe', 'detyrime'], hub: msg('Debts|menu') },
      { label: msg('Partner cards|menu'), href: '/finance/cards', icon: BookUser, perm: 'invoicing.read', keywords: ['kartela', 'kartela e klientit', 'kartela e furnitorit', 'ios', 'konfirmim', 'statement', 'saldo'], hub: msg('Debts|menu') },
      { label: msg('Bank and cash'), href: '/finance/bank', icon: Landmark, perm: 'finance.read', keywords: ['reconciliation', 'statement', 'banka'], hub: msg('Cash and bank|menu') },
      { label: msg('Cash book|ledger'), href: '/finance/cash-book', icon: Coins, perm: 'finance.read', keywords: ['ditari i arkës', 'libri i arkës', 'arka', 'cash book', 'para në dorë'], hub: msg('Cash and bank|menu') },
      { label: msg('Cash forecast'), href: '/finance/cash-forecast', icon: ChartSpline, perm: 'finance.read', keywords: ['parashikimi', 'cash flow', 'rrjedha e parasë', 'paraja', 'likuiditeti', 'liquidity', '13 javë', 'forecast', 'minus'], hub: msg('Cash and bank|menu') },
      { label: msg('Expenses'), href: '/finance/expenses', icon: ReceiptText, perm: 'invoicing.read', keywords: ['shpenzime', 'shpenzim', 'karburant', 'naftë', 'rryma', 'kupon', 'faturë', 'foto', 'receipt', 'fuel', 'expense'], hub: msg('Expenses|hub') },
      { label: msg('Internal costs|menu'), href: '/finance/internal-costs', icon: Calculator, perm: 'finance.read', keywords: ['kosto e brendshme', 'kostot e brendshme', 'qira e brendshme', 'menaxhim', 'ndarja e shpenzimeve', 'internal rent', 'management costs', 'allocation'], hub: msg('Expenses|hub') },
      { label: msg('Fixed assets|menu'), href: '/finance/assets', icon: Building, perm: 'finance.read', keywords: ['depreciation', 'amortization', 'aktive'], hub: msg('Assets|menu') },
      { label: msg('Small inventory|menu'), href: '/finance/small-assets', icon: Archive, perm: 'finance.read', keywords: ['pajisjet', 'pajisjet dhe inventari', 'inventari', 'inventar i imët', 'pajisje', 'mjete', 'karrige', 'rafte', 'peshore', 'small assets', 'equipment'], hub: msg('Assets|menu') },
      { label: msg('Assets from invoices'), href: '/finance/asset-invoices', icon: FileScan, perm: 'finance.read', keywords: ['mjete themelore', 'faturë', 'foto', 'investim', 'veturë', 'kompjuter', 'asset invoice'], hub: msg('Assets|menu') },
    ],
  },
  {
    label: msg('People'),
    title: msg('People|menu'),
    items: [
      { label: msg('People overview'), href: '/hr', icon: UsersRound, perm: 'hr.read', keywords: ['hr', 'headcount', 'burime njerëzore'], hub: msg('People|menu') },
      { label: msg('Employees|menu'), href: '/hr/employees', icon: Contact, perm: 'hr.read', keywords: ['staff', 'punonjës', 'contracts'], hub: msg('People|menu') },
      { label: msg('Contracts|hr'), href: '/hr/contracts', icon: FileSignature, perm: 'payroll.read', keywords: ['kontrata', 'kontratat e punës', 'aneks', 'employment contract', 'annex', 'ndërprerje', 'njoftim'], hub: msg('People|menu') },
      { label: msg('Leave'), href: '/hr/leave', icon: CalendarDays, perm: 'hr.read', keywords: ['holiday', 'vacation', 'pushime', 'absence', 'sick'], hub: msg('People|menu') },
      { label: msg('Attendance'), href: '/hr/attendance', icon: Clock, perm: 'hr.read', keywords: ['timesheet', 'clock in', 'prezenca', 'overtime'], hub: msg('People|menu') },
      { label: msg('Payroll'), href: '/hr/payroll', icon: Banknote, perm: 'payroll.read', keywords: ['salaries', 'payslips', 'listëpagesa', 'tap', 'contributions', 'paga'], hub: msg('People|menu') },
      { label: msg('My workplace'), href: '/hr/me', icon: UserRound, perm: 'core.read', keywords: ['my leave', 'my payslips', 'clock in', 'self-service'], always: true, hub: msg('People|menu') },
      { label: msg('HR setup'), href: '/hr/setup', icon: Settings2, perm: 'hr.read', keywords: ['cilësimet e punonjësve', 'departamente', 'pozita', 'pushime', 'hr settings', 'departments', 'positions'], hub: msg('People|menu') },
    ],
  },
  {
    // the accountant's part: the books and the taxes
    label: msg('Accounting'),
    title: msg('Accounting and taxes|menu'),
    items: [
      { label: msg('Books check'), href: '/check', icon: ShieldCheck, perm: 'invoicing.read', keywords: ['kontrolli', 'gabime', 'gabimet', 'mistakes', 'check', 'kujdestari', 'pa faturë', 'minus', 'nui'] },
      { label: msg('VAT books|menu'), href: '/tax/books', icon: BookOpen, perm: 'tax.read', keywords: ['libri i shitjes', 'libri i shitjeve', 'sales book', 'vat book', 'tvsh', 'libri i blerjes', 'libri i blerjeve', 'purchase book'], hub: msg('VAT|menu'), part: msg('Taxes and books') },
      { label: msg('VAT declarations'), href: '/tax/declarations', icon: ClipboardPen, perm: 'tax.read', keywords: ['vat return', 'deklarata', 'tvsh', 'dpt', 'atk'], hub: msg('VAT|menu'), part: msg('Taxes and books') },
      { label: msg('Corporate income tax'), href: '/tax/income-tax', icon: PieChart, perm: 'tax.read', keywords: ['tatimi mbi fitimin', 'tatim fitimi', 'cit', 'profit tax', 'deklarata vjetore'], hub: msg('Other taxes|menu'), part: msg('Taxes and books') },
      { label: msg('Withholding tax'), href: '/tax/withholding', icon: HandCoins, perm: 'tax.read', keywords: ['tatim në burim', 'tatimi në burim', 'withholding', 'qira', 'rent', 'wht'], hub: msg('Other taxes|menu'), part: msg('Taxes and books') },
      { label: msg('Small business tax'), href: '/tax/small-business', icon: BadgePercent, perm: 'tax.read', keywords: ['biznes i vogël', 'biznes i vogel', '3%', '9%', 'tremujor', 'qarkullim', 'small business', 'turnover tax'], hub: msg('Other taxes|menu'), part: msg('Taxes and books') },
      { label: msg('Journal entries|menu'), href: '/finance/journal', icon: BookOpen, perm: 'finance.read', keywords: ['gl', 'general ledger', 'manual entry', 'ditar'], hub: msg('Bookkeeping|menu') },
      { label: msg('Account card'), href: '/finance/account-card', icon: NotebookTabs, perm: 'finance.read', keywords: ['kartela e kontos', 'libri kryesor', 'general ledger', 'account ledger'], hub: msg('Bookkeeping|menu') },
      { label: msg('Chart of accounts'), href: '/finance/accounts', icon: ListTree, perm: 'finance.read', keywords: ['coa', 'ledger', 'plan kontabel', 'accounts'], hub: msg('Bookkeeping|menu') },
      { label: msg('Cost centers|menu'), href: '/finance/cost-centers', icon: Network, perm: 'finance.read', keywords: ['departments', 'branches', 'projects'], hub: msg('Bookkeeping|menu') },
      { label: msg('Financial statements'), href: '/finance/reports', icon: BarChart3, perm: 'finance.read', keywords: ['p&l', 'profit and loss', 'balance sheet', 'cash flow', 'trial balance', 'bilanc', 'comparison'] },
      { label: msg('Year-end close'), href: '/finance/year-end', icon: CalendarCheck, perm: 'finance.read', keywords: ['mbyllja e vitit', 'mbyllje', 'year end', 'closing', 'fitimi i vitit', '109', '108'] },
      { label: msg('Finance setup'), href: '/finance/setup', icon: Settings2, perm: 'finance.read', keywords: ['posting accounts', 'periods', 'close', 'fiscal year', 'journals'], hub: msg('Accounting setup|menu') },
      { label: msg('Tax codes|menu'), href: '/tax/codes', icon: Percent, perm: 'tax.read', keywords: ['vat rates', 'exempt', 'reverse charge'], hub: msg('Accounting setup|menu') },
      { label: msg('Fiscalization'), href: '/tax/fiscalization', icon: Fingerprint, perm: 'tax.read', keywords: ['nivf', 'nslf', 'iic', 'fic', 'cis', 'efiskalizimi', 'qr'], hub: msg('Accounting setup|menu') },
    ],
  },
  {
    label: msg('Manufacturing'),
    items: [
      { label: msg('Production overview'), href: '/manufacturing', icon: Activity, perm: 'manufacturing.read', keywords: ['production', 'mrp', 'plan', 'prodhim', 'capacity'], hub: msg('Manufacturing') },
      { label: msg('Work orders|menu'), href: '/manufacturing/orders', icon: Factory, perm: 'manufacturing.read', keywords: ['wo', 'production order', 'manufacturing order', 'urdhër pune'], hub: msg('Manufacturing') },
      { label: msg('Bills of materials'), href: '/manufacturing/boms', also: true, icon: Layers, perm: 'manufacturing.read', keywords: ['receta', 'recipe', 'kit', 'ingredients', 'përbërës', 'kafe', 'restorant'], hub: msg('Manufacturing') },
      { label: msg('Work centers|menu'), href: '/manufacturing/work-centers', icon: Cog, perm: 'manufacturing.read', keywords: ['machines', 'lines', 'capacity', 'rates'], hub: msg('Manufacturing') },
    ],
  },
  {
    label: msg('Logistics'),
    title: msg('Logistics|menu'),
    items: [
      { label: msg('Logistics overview'), href: '/logistics', icon: Map, perm: 'logistics.read', keywords: ['transport', 'fleet', 'kpi', 'transport'], hub: msg('Logistics|menu') },
      { label: msg('Delivery planning'), href: '/logistics/planning', icon: MapPinned, perm: 'logistics.read', keywords: ['routes', 'dispatch', 'vans', 'drivers', 'plan'], hub: msg('Logistics|menu') },
      { label: msg('Shipments'), href: '/logistics/shipments', icon: Route, perm: 'logistics.read', keywords: ['tracking', 'carrier', 'cod', 'cash on delivery', 'dërgesa'], hub: msg('Logistics|menu') },
      { label: msg('Carriers and fleet'), href: '/logistics/setup', icon: PackageDone, perm: 'logistics.read', keywords: ['vehicles', 'carriers', 'vans', 'courier'], hub: msg('Logistics|menu') },
    ],
  },
  {
    // the numbers, in one place
    label: msg('Reports|menu'),
    items: [
      { label: msg('Reports'), href: '/reports', icon: FileBarChart, perm: 'reports.read', keywords: ['analytics', 'sales analysis', 'margin', 'valuation', 'aging', 'raporte'], hub: msg('Reports|menu') },
      { label: msg('Manager\'s panel|menu'), href: '/reports/kpi', icon: Gauge, perm: 'reports.read', keywords: ['kpi', 'plan', 'target', 'objektiv', 'realizimi', 'kupon mesatar', 'average receipt', 'marzh', 'humbje', 'qarkullimi', 'menaxher', 'performance'], hub: msg('Reports|menu') },
      { label: msg('Sales analysis|menu'), href: '/reports/sales', icon: ListTree, perm: 'sales.read', keywords: ['analiza e shitjeve', 'shitjet e detajuara', 'sales by item', 'margin', 'marzha', 'kuponat', 'receipts', 'by customer', 'by hour', 'filters'], hub: msg('Reports|menu') },
      { label: msg('Purchase analysis|menu'), href: '/reports/purchases', icon: ListTree, perm: 'procurement.read|invoicing.read', keywords: ['analiza e blerjeve', 'blerjet e detajuara', 'purchases by item', 'import costs', 'kosto e importit', 'rabat', 'discount', 'by supplier', 'filters'], hub: msg('Reports|menu') },
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
    title: msg('Administration|menu'),
    items: [
      { label: msg('Company settings|menu'), href: '/settings', icon: Building2, perm: 'admin.read', keywords: ['profile', 'nipt', 'fiscal codes', 'preferences'], hub: msg('Settings|menu') },
      { label: msg('Users and roles'), href: '/settings/users', icon: KeyRound, perm: 'admin.read', keywords: ['invite', 'members', 'permissions', 'roles', 'access', 'security', 'siguria', 'permission matrix', 'custom role'], hub: msg('Settings|menu') },
      // the units are how the company is built: found here too, not only under the stock
      { label: msg('Warehouses|menu'), href: '/inventory/warehouses', icon: Store, perm: 'inventory.read', also: true, keywords: ['njësitë', 'njësitë e biznesit', 'dyqanet', 'marketet', 'lokalet', 'depot', 'pikat', 'units', 'branches'], hub: msg('Settings|menu') },
      { label: msg('Numbering'), href: '/settings/numbering', icon: ListOrdered, perm: 'admin.read', keywords: ['sequences', 'prefix', 'document numbers'], hub: msg('Settings|menu') },
      { label: msg('Automations'), href: '/settings/automation', icon: Zap, perm: 'core.read', keywords: ['automatic', 'schedule', 'automatizim', 'email', 'whatsapp', 'reminders'], hub: msg('Settings|menu') },
      { label: msg('AI agent|menu'), href: '/settings/assistant', icon: Brain, perm: 'core.read', keywords: ['agjenti', 'asistenti', 'ai', 'inteligjenca artificiale', 'trajno', 'mëso', 'rregulla', 'çka di agjenti', 'teach', 'knowledge', 'memory'], hub: msg('Settings|menu') },
      { label: msg('Approval workflows|menu'), href: '/settings/workflows', icon: Workflow, perm: 'admin.read', keywords: ['approval limits', 'approvers'], hub: msg('Settings|menu') },
      { label: msg('Import data'), href: '/settings/import', icon: Import, perm: 'core.read', keywords: ['csv', 'excel', 'upload', 'migration', 'opening balances'], hub: msg('Settings|menu') },
      { label: msg('Move from another program'), href: '/settings/migration', icon: ArrowDownToLine, perm: 'admin.write', keywords: ['migration', 'kubit', 'logmicro', 'bilanc', 'pantheon', 'opening balances', 'cut-over', 'kalimi', 'migrimi'], hub: msg('Settings|menu') },
      { label: msg('B2B portal and API|menu'), href: '/settings/integrations', icon: Plug, perm: 'admin.read', keywords: ['api', 'b2b', 'portal', 'portali', 'web shop', 'dyqan online', 'integrim', 'key', 'çelës', 'woocommerce', 'shopify', 'chatgpt', 'claude', 'mcp', 'ai'], hub: msg('Settings|menu') },
      { label: msg('Audit log|menu'), href: '/settings/audit', icon: History, perm: 'audit.read', keywords: ['history', 'changes', 'who changed'], hub: msg('Settings|menu') },
    ],
  },
]
