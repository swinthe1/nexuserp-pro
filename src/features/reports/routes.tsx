import type { RouteObject } from 'react-router-dom'
import { RequirePerm, lazyPage } from '@/app/require-perm'

const ReportsPage = lazyPage(() => import('./pages/reports-page'), 'ReportsPage')
const ReportPage = lazyPage(() => import('./pages/report-page'), 'ReportPage')
const KpiPage = lazyPage(() => import('./pages/kpi-page'), 'KpiPage')
const AnalysisPage = lazyPage(() => import('./pages/analysis-page'), 'AnalysisPage')
const ProfitPage = lazyPage(() => import('./pages/profit-page'), 'ProfitPage')
const FulfillmentPage = lazyPage(() => import('@/features/oms/pages/fulfillment-page'), 'FulfillmentPage')

export const reportsRoutes: RouteObject[] = [
  { path: 'reports', element: <RequirePerm perm="core.read" />, children: [
    { index: true, element: <ReportsPage /> },
    { path: 'kpi', element: <RequirePerm perm="reports.read" />, children: [{ index: true, element: <KpiPage /> }] },
    { path: 'analysis', element: <RequirePerm perm="sales.read|procurement.read" />, children: [{ index: true, element: <AnalysisPage /> }] },
    { path: 'profit', element: <RequirePerm perm="finance.read|reports.read" />, children: [{ index: true, element: <ProfitPage /> }] },
    { path: ':key', element: <ReportPage /> },
  ] },
]

export const omsRoutes: RouteObject[] = [
  { path: 'oms', element: <RequirePerm perm="sales.read" />, children: [
    { path: 'fulfillment', element: <FulfillmentPage /> },
  ] },
]
