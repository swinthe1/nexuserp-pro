import * as React from 'react'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import { AppLayout } from '@/app/layouts/app-layout'
import { AuthLayout } from '@/app/layouts/auth-layout'
import { PageErrorBoundary } from '@/components/page-error-boundary'
import { ForgotPasswordPage, LoginPage, ResetPasswordPage } from '@/features/auth/auth-pages'
import { OnboardingPage } from '@/features/auth/onboarding-page'
import { isSupportVisit } from '@/components/license-banner'
import { lazyPage } from '@/app/require-perm'
import { NotFoundPage } from '@/features/misc/coming-soon-page'
import { RequirePerm } from '@/app/require-perm'
import { useCompany } from '@/app/company-provider'
import { taxRoutes } from '@/features/tax/routes'
import { hrRoutes } from '@/features/hr/routes'
import { logisticsRoutes, ecommerceRoutes } from '@/features/logistics/routes'
import { reportsRoutes, omsRoutes } from '@/features/reports/routes'
import { settingsRoutes, notificationsRoutes } from '@/features/settings/routes'
import { SimpleHome } from '@/features/simple/simple-home'

// Route-level code splitting: each module loads on first visit
const lazy = <T,>(load: () => Promise<T>, name: keyof T) =>
  React.lazy(() => load().then((m) => ({ default: m[name] as unknown as React.ComponentType })))

const DashboardPage = lazy(() => import('@/features/dashboard/dashboard-page'), 'DashboardPage')
const ApprovalsPage = lazy(() => import('@/features/approvals/approvals-page'), 'ApprovalsPage')
const ProductsPage = lazy(() => import('@/features/inventory/pages/products-page'), 'ProductsPage')
const ProductNewPage = lazy(() => import('@/features/inventory/pages/product-new-page'), 'ProductNewPage')
const ProductDetailPage = lazy(() => import('@/features/inventory/pages/product-detail-page'), 'ProductDetailPage')
const StockPage = lazy(() => import('@/features/inventory/pages/stock-page'), 'StockPage')
const MovementsPage = lazy(() => import('@/features/inventory/pages/movements-page'), 'MovementsPage')
const AlertsPage = lazy(() => import('@/features/inventory/pages/alerts-page'), 'AlertsPage')
const RecurringPage = lazy(() => import('@/features/sales/recurring'), 'RecurringPage')
const ReadInvoicePage = lazy(() => import('@/features/inventory/pages/read-invoice-page'), 'ReadInvoicePage')
const PricesPage = lazy(() => import('@/features/inventory/pages/prices-page'), 'PricesPage')
const ReceiptPage = lazy(() => import('@/features/inventory/pages/receipt-page'), 'ReceiptPage')
const AdjustmentPage = lazy(() => import('@/features/inventory/pages/adjustment-page'), 'AdjustmentPage')
const TransferPage = lazy(() => import('@/features/inventory/pages/transfer-page'), 'TransferPage')
const LandedCostPage = lazy(() => import('@/features/inventory/pages/landed-cost-page'), 'LandedCostPage')
const DocumentsPage = React.lazy(() => import('@/features/inventory/pages/documents-page').then((m) => ({ default: m.DocumentsPage })))
const WarehousesPage = lazy(() => import('@/features/inventory/pages/warehouses-page'), 'WarehousesPage')
const SetupPage = lazy(() => import('@/features/inventory/pages/setup-page'), 'SetupPage')
const SalesOverviewPage = lazy(() => import('@/features/sales/pages/sales-overview-page'), 'SalesOverviewPage')
const PipelinePage = lazy(() => import('@/features/sales/pages/pipeline-page'), 'PipelinePage')
const LeadsPage = lazy(() => import('@/features/sales/pages/leads-page'), 'LeadsPage')
const SalesListPage = React.lazy(() => import('@/features/sales/pages/sales-list-page').then((m) => ({ default: m.SalesListPage })))
const SalesDocumentPage = React.lazy(() => import('@/features/sales/pages/sales-document-page').then((m) => ({ default: m.SalesDocumentPage })))
const DeliveryPage = lazy(() => import('@/features/sales/pages/delivery-page'), 'DeliveryPage')
const PriceListsPage = lazy(() => import('@/features/sales/pages/price-lists-page'), 'PriceListsPage')
const PriceListPage = lazy(() => import('@/features/sales/pages/price-lists-page'), 'PriceListPage')
const PartnersPage = lazy(() => import('@/features/sales/pages/partners-page'), 'PartnersPage')
const PartnerPage = lazy(() => import('@/features/sales/pages/partners-page'), 'PartnerPage')
const ProcurementOverviewPage = lazy(() => import('@/features/procurement/pages/procurement-overview-page'), 'ProcurementOverviewPage')
const ProcurementListPage = React.lazy(() => import('@/features/procurement/pages/procurement-list-page').then((m) => ({ default: m.ProcurementListPage })))
const PurchaseDocumentPage = React.lazy(() => import('@/features/procurement/pages/purchase-document-page').then((m) => ({ default: m.PurchaseDocumentPage })))
const RequisitionPage = lazy(() => import('@/features/procurement/pages/requisition-page'), 'RequisitionPage')
const ReplenishmentPage = lazy(() => import('@/features/procurement/pages/replenishment-page'), 'ReplenishmentPage')
const VendorPricesPage = lazy(() => import('@/features/procurement/pages/vendor-prices-page'), 'VendorPricesPage')
const FinanceOverviewPage = lazy(() => import('@/features/finance/pages/finance-overview-page'), 'FinanceOverviewPage')
const AccountsPage = lazy(() => import('@/features/finance/pages/accounts-page'), 'AccountsPage')
const AccountLedgerPage = lazy(() => import('@/features/finance/pages/accounts-page'), 'AccountLedgerPage')
const JournalEntriesPage = lazy(() => import('@/features/finance/pages/journal-page'), 'JournalEntriesPage')
const JournalEntryPage = lazy(() => import('@/features/finance/pages/journal-page'), 'JournalEntryPage')
const PaymentsPage = lazy(() => import('@/features/finance/pages/payments-page'), 'PaymentsPage')
const PaymentPage = lazy(() => import('@/features/finance/pages/payments-page'), 'PaymentPage')
const AgingPage = React.lazy(() => import('@/features/finance/pages/aging-page').then((m) => ({ default: m.AgingPage })))
const BankPage = lazy(() => import('@/features/finance/pages/bank-page'), 'BankPage')
const StatementPage = lazy(() => import('@/features/finance/pages/bank-page'), 'StatementPage')
const AssetsPage = lazy(() => import('@/features/finance/pages/assets-page'), 'AssetsPage')
const AssetPage = lazy(() => import('@/features/finance/pages/assets-page'), 'AssetPage')
const CostCentersPage = lazy(() => import('@/features/finance/pages/cost-centers-page'), 'CostCentersPage')
const ReportsPage = lazy(() => import('@/features/finance/pages/reports-page'), 'ReportsPage')
const FinanceSetupPage = lazy(() => import('@/features/finance/pages/finance-setup-page'), 'FinanceSetupPage')
const WmsHomePage = lazy(() => import('@/features/wms/pages/wms-home-page'), 'WmsHomePage')
const ReceiveListPage = lazy(() => import('@/features/wms/pages/receive-page'), 'ReceiveListPage')
const ReceiveScanPage = lazy(() => import('@/features/wms/pages/receive-page'), 'ReceiveScanPage')
const TaskPage = lazy(() => import('@/features/wms/pages/task-page'), 'TaskPage')
const PutawayListPage = lazy(() => import('@/features/wms/pages/flow-pages'), 'PutawayListPage')
const PickingPage = lazy(() => import('@/features/wms/pages/flow-pages'), 'PickingPage')
const ShippingPage = lazy(() => import('@/features/wms/pages/flow-pages'), 'ShippingPage')
const MovePage = lazy(() => import('@/features/wms/pages/move-page'), 'MovePage')
const CountsPage = lazy(() => import('@/features/wms/pages/counts-page'), 'CountsPage')
const CountPage = lazy(() => import('@/features/wms/pages/counts-page'), 'CountPage')
const LotsPage = lazy(() => import('@/features/wms/pages/lots-page'), 'LotsPage')
const LotTracePage = lazy(() => import('@/features/wms/pages/lots-page'), 'LotTracePage')

const PosHomePage = lazy(() => import('@/features/pos/pages/pos-home-page'), 'PosHomePage')
const PosSessionPage = lazy(() => import('@/features/pos/pages/pos-home-page'), 'PosSessionPage')
const TillPage = lazy(() => import('@/features/pos/pages/till-page'), 'TillPage')
const SafePage = lazy(() => import('@/features/safe/safe-page'), 'SafePage')
const LoyaltyPage = lazy(() => import('@/features/loyalty/loyalty-page'), 'LoyaltyPage')
const WaitersPage = lazy(() => import('@/features/restaurant/waiters-page'), 'WaitersPage')
const HistoryPage = lazy(() => import('@/features/history/history-page'), 'HistoryPage')
const FloorPage = lazy(() => import('@/features/restaurant/floor-page'), 'FloorPage')
const KitchenPage = lazy(() => import('@/features/restaurant/kitchen-page'), 'KitchenPage')

const MfgOverviewPage = lazy(() => import('@/features/manufacturing/pages/mfg-overview-page'), 'MfgOverviewPage')
const WorkCentersPage = lazy(() => import('@/features/manufacturing/pages/mfg-overview-page'), 'WorkCentersPage')
const WorkOrdersPage = lazy(() => import('@/features/manufacturing/pages/work-orders-page'), 'WorkOrdersPage')
const WorkOrderPage = lazy(() => import('@/features/manufacturing/pages/work-orders-page'), 'WorkOrderPage')
const BomsPage = lazy(() => import('@/features/manufacturing/pages/boms-page'), 'BomsPage')
const BomPage = lazy(() => import('@/features/manufacturing/pages/boms-page'), 'BomPage')

const ErrorBoundary = ({ children }: { children: React.ReactNode }) => <PageErrorBoundary fullScreen>{children}</PageErrorBoundary>

/**
 * Where each person starts: the screen they use all day, not a manager's dashboard.
 * Cashiers open the till list, warehouse staff the scanner screens, drivers' and logistics
 * leads the delivery board, employees without other access their own workplace page.
 */
function Home() {
  const { can, isSuperAdmin, company, simple } = useCompany()
  if (simple && company) return <SimpleHome />
  // the platform owner starts on the client list, unless they chose to look inside this client
  if (isSuperAdmin && company && !company.roles.length && !isSupportVisit(company.id)) return <Navigate to="/platform" replace />
  const manager = can('reports.read') && (can('sales.read') || can('finance.read'))
  if (can('pos.write') && !can('sales.read') && !can('finance.read')) return <Navigate to="/pos" replace />
  if (can('logistics.delete') && !can('sales.write') && !can('finance.read')) return <Navigate to="/logistics/planning" replace />
  if (can('wms.write') && !can('inventory.write') && !can('sales.write') && !can('finance.read') && !manager) return <Navigate to="/wms" replace />
  if (can('hr.read') && !can('sales.read') && !can('finance.read') && !can('inventory.read')) return <Navigate to="/hr" replace />
  if (!can('reports.read') && !can('sales.read') && !can('inventory.read') && !can('finance.read')) return <Navigate to="/hr/me" replace />
  return <DashboardPage />
}

const PlatformPage = lazyPage(() => import('@/features/platform/platform-page'), 'PlatformPage')

const router = createBrowserRouter([
  {
    element: <AuthLayout />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/signup', element: <Navigate to="/login" replace /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
    ],
  },
  { path: '/reset-password', element: <div className="mx-auto max-w-sm px-6 py-16"><ResetPasswordPage /></div> },
  { path: '/onboarding', element: <OnboardingPage /> },
  { path: '/platform', element: <ErrorBoundary><React.Suspense fallback={<div className="h-dvh bg-background" />}><PlatformPage /></React.Suspense></ErrorBoundary> },
  // the till runs full screen, outside the app shell, so it keeps working offline
  { path: '/pos/till/:registerId', element: <ErrorBoundary><React.Suspense fallback={<div className="h-dvh bg-background" />}><TillPage /></React.Suspense></ErrorBoundary> },
  { path: '/pos/floor/:registerId', element: <ErrorBoundary><React.Suspense fallback={<div className="h-dvh bg-background" />}><FloorPage /></React.Suspense></ErrorBoundary> },
  { path: '/pos/kitchen/:warehouseId', element: <ErrorBoundary><React.Suspense fallback={<div className="h-dvh bg-background" />}><KitchenPage /></React.Suspense></ErrorBoundary> },
  {
    element: <ErrorBoundary><AppLayout /></ErrorBoundary>,
    children: [
      { element: <RequirePerm perm="core.read" />, children: [
        { index: true, element: <Home /> },
        { path: 'approvals', element: <ApprovalsPage /> },
      ] },
      { path: 'inventory', element: <RequirePerm perm="inventory.read" />, children: [
        { index: true, element: <Navigate to="products" replace /> },
        { path: 'products', element: <ProductsPage /> },
        { path: 'products/new', element: <ProductNewPage /> },
        { path: 'products/:id', element: <ProductDetailPage /> },
        { path: 'stock', element: <StockPage /> },
        { path: 'movements', element: <MovementsPage /> },
        { path: 'alerts', element: <AlertsPage /> },
        { path: 'prices', element: <PricesPage /> },
        { path: 'read-invoice', element: <ReadInvoicePage /> },
        { path: 'receipts', element: <DocumentsPage kind="receipts" /> },
        { path: 'receipts/new', element: <ReceiptPage /> },
        { path: 'receipts/:id', element: <ReceiptPage /> },
        { path: 'adjustments', element: <DocumentsPage kind="adjustments" /> },
        { path: 'adjustments/new', element: <AdjustmentPage /> },
        { path: 'adjustments/:id', element: <AdjustmentPage /> },
        { path: 'transfers', element: <DocumentsPage kind="transfers" /> },
        { path: 'transfers/new', element: <TransferPage /> },
        { path: 'transfers/:id', element: <TransferPage /> },
        { path: 'landed-costs', element: <DocumentsPage kind="landed-costs" /> },
        { path: 'landed-costs/new', element: <LandedCostPage /> },
        { path: 'landed-costs/:id', element: <LandedCostPage /> },
        { path: 'warehouses', element: <WarehousesPage /> },
        { path: 'setup', element: <SetupPage /> },
      ] },
      { path: 'crm', element: <RequirePerm perm="crm.read" />, children: [
        { index: true, element: <Navigate to="pipeline" replace /> },
        { path: 'pipeline', element: <PipelinePage /> },
        { path: 'leads', element: <LeadsPage /> },
      ] },
      { path: 'sales', element: <RequirePerm perm="sales.read" />, children: [
        { index: true, element: <SalesOverviewPage /> },
        { path: 'quotes', element: <SalesListPage key="quotes" kind="quotes" /> },
        { path: 'quotes/new', element: <SalesDocumentPage key="quote-new" kind="quotes" /> },
        { path: 'quotes/:id', element: <SalesDocumentPage key="quote" kind="quotes" /> },
        { path: 'orders', element: <SalesListPage key="orders" kind="orders" /> },
        { path: 'orders/new', element: <SalesDocumentPage key="order-new" kind="orders" /> },
        { path: 'orders/:id', element: <SalesDocumentPage key="order" kind="orders" /> },
        { path: 'deliveries', element: <SalesListPage key="deliveries" kind="deliveries" /> },
        { path: 'deliveries/:id', element: <DeliveryPage /> },
        { path: 'price-lists', element: <PriceListsPage /> },
        { path: 'price-lists/new', element: <PriceListPage key="pl-new" /> },
        { path: 'price-lists/:id', element: <PriceListPage key="pl" /> },
      ] },
      { path: 'sales/invoices', element: <RequirePerm perm="invoicing.read" />, children: [
        { index: true, element: <SalesListPage key="invoices" kind="invoices" /> },
        { path: 'new', element: <SalesDocumentPage key="invoice-new" kind="invoices" /> },
        { path: ':id', element: <SalesDocumentPage key="invoice" kind="invoices" /> },
      ] },
      { path: 'sales/recurring', element: <RequirePerm perm="invoicing.read" />, children: [{ index: true, element: <RecurringPage /> }] },
      { path: 'partners', element: <RequirePerm perm="partners.read" />, children: [
        { index: true, element: <PartnersPage /> },
        { path: 'new', element: <PartnerPage key="new" /> },
        { path: ':id', element: <PartnerPage key="partner" /> },
      ] },
      { path: 'procurement', element: <RequirePerm perm="procurement.read" />, children: [
        { index: true, element: <ProcurementOverviewPage /> },
        { path: 'orders', element: <ProcurementListPage key="orders" kind="orders" /> },
        { path: 'orders/new', element: <PurchaseDocumentPage key="po-new" kind="orders" /> },
        { path: 'orders/:id', element: <PurchaseDocumentPage key="po" kind="orders" /> },
        { path: 'replenishment', element: <ReplenishmentPage /> },
        { path: 'vendor-prices', element: <VendorPricesPage /> },
      ] },
      { path: 'procurement/requisitions', element: <RequirePerm perm="requisitions.read" />, children: [
        { index: true, element: <ProcurementListPage key="requisitions" kind="requisitions" /> },
        { path: 'new', element: <RequisitionPage key="req-new" /> },
        { path: ':id', element: <RequisitionPage key="req" /> },
      ] },
      { path: 'procurement/bills', element: <RequirePerm perm="invoicing.read" />, children: [
        { index: true, element: <ProcurementListPage key="bills" kind="bills" /> },
        { path: 'new', element: <PurchaseDocumentPage key="bill-new" kind="bills" /> },
        { path: ':id', element: <PurchaseDocumentPage key="bill" kind="bills" /> },
      ] },
      { path: 'finance/payments', element: <RequirePerm perm="invoicing.read" />, children: [
        { index: true, element: <PaymentsPage /> },
        { path: 'new', element: <PaymentPage key="pay-new" /> },
        { path: ':id', element: <PaymentPage key="pay" /> },
      ] },
      { path: 'finance/receivables', element: <RequirePerm perm="invoicing.read" />, children: [{ index: true, element: <AgingPage key="ar" kind="ar" /> }] },
      { path: 'finance/payables', element: <RequirePerm perm="invoicing.read" />, children: [{ index: true, element: <AgingPage key="ap" kind="ap" /> }] },
      { path: 'finance', element: <RequirePerm perm="finance.read" />, children: [
        { index: true, element: <FinanceOverviewPage /> },
        { path: 'accounts', element: <AccountsPage /> },
        { path: 'accounts/:id', element: <AccountLedgerPage /> },
        { path: 'journal', element: <JournalEntriesPage /> },
        { path: 'journal/new', element: <JournalEntryPage key="je-new" /> },
        { path: 'journal/:id', element: <JournalEntryPage key="je" /> },
        { path: 'bank', element: <BankPage /> },
        { path: 'bank/statements/:id', element: <StatementPage /> },
        { path: 'assets', element: <AssetsPage /> },
        { path: 'assets/new', element: <AssetPage key="asset-new" /> },
        { path: 'assets/:id', element: <AssetPage key="asset" /> },
        { path: 'cost-centers', element: <CostCentersPage /> },
        { path: 'reports', element: <ReportsPage /> },
        { path: 'setup', element: <FinanceSetupPage /> },
      ] },
      { path: 'safe', element: <RequirePerm perm="pos.approve|finance.read" />, children: [{ index: true, element: <SafePage /> }] },
      { path: 'history', element: <RequirePerm perm="invoicing.read" />, children: [{ index: true, element: <HistoryPage /> }] },
      { path: 'pos', element: <RequirePerm perm="pos.read" />, children: [
        { index: true, element: <PosHomePage /> },
        { path: 'sessions/:id', element: <PosSessionPage /> },
        { path: 'loyalty', element: <LoyaltyPage /> },
        { path: 'waiters', element: <WaitersPage /> },
      ] },
      { path: 'wms', element: <RequirePerm perm="wms.read" />, children: [
        { index: true, element: <WmsHomePage /> },
        { path: 'receive', element: <ReceiveListPage /> },
        { path: 'receive/:id', element: <ReceiveScanPage /> },
        { path: 'putaway', element: <PutawayListPage /> },
        { path: 'picking', element: <PickingPage /> },
        { path: 'shipping', element: <ShippingPage /> },
        { path: 'tasks/:id', element: <TaskPage /> },
        { path: 'move', element: <MovePage /> },
        { path: 'counts', element: <CountsPage /> },
        { path: 'counts/:id', element: <CountPage /> },
        { path: 'lots', element: <LotsPage /> },
        { path: 'lots/:id', element: <LotTracePage /> },
      ] },
      { path: 'manufacturing', element: <RequirePerm perm="manufacturing.read" />, children: [
        { index: true, element: <MfgOverviewPage /> },
        { path: 'orders', element: <WorkOrdersPage /> },
        { path: 'orders/:id', element: <WorkOrderPage key="wo" /> },
        { path: 'boms', element: <BomsPage /> },
        { path: 'boms/new', element: <BomPage key="bom-new" /> },
        { path: 'boms/:id', element: <BomPage key="bom" /> },
        { path: 'work-centers', element: <WorkCentersPage /> },
      ] },
      ...taxRoutes,
      ...hrRoutes,
      ...logisticsRoutes,
      ...ecommerceRoutes,
      ...reportsRoutes,
      ...omsRoutes,
      ...settingsRoutes,
      ...notificationsRoutes,
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
