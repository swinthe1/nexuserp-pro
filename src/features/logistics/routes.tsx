import { Navigate, type RouteObject } from 'react-router-dom'
import { lazyPage, RequirePerm } from '@/app/require-perm'

const LogisticsOverviewPage = lazyPage(() => import('./pages/logistics-overview-page'), 'LogisticsOverviewPage')
const PlanningPage = lazyPage(() => import('./pages/planning-page'), 'PlanningPage')
const RoutePage = lazyPage(() => import('./pages/route-page'), 'RoutePage')
const ShipmentsPage = lazyPage(() => import('./pages/shipments-page'), 'ShipmentsPage')
const ShipmentPage = lazyPage(() => import('./pages/shipments-page'), 'ShipmentPage')
const LogisticsSetupPage = lazyPage(() => import('./pages/setup-page'), 'LogisticsSetupPage')
const ChannelsPage = lazyPage(() => import('@/features/ecommerce/pages/channels-page'), 'ChannelsPage')
const ChannelPage = lazyPage(() => import('@/features/ecommerce/pages/channels-page'), 'ChannelPage')

export const logisticsRoutes: RouteObject[] = [
  { path: 'logistics', element: <RequirePerm perm="logistics.read" />, children: [
    { index: true, element: <LogisticsOverviewPage /> },
    { path: 'planning', element: <PlanningPage /> },
    { path: 'routes', element: <Navigate to="/logistics/planning" replace /> },
    { path: 'routes/:id', element: <RoutePage key="route" /> },
    { path: 'shipments', element: <ShipmentsPage /> },
    { path: 'shipments/:id', element: <ShipmentPage key="shipment" /> },
    { path: 'setup', element: <LogisticsSetupPage /> },
  ] },
]

export const ecommerceRoutes: RouteObject[] = [
  { path: 'ecommerce', element: <RequirePerm perm="ecommerce.read" />, children: [
    { index: true, element: <ChannelsPage /> },
    { path: ':id', element: <ChannelPage key="channel" /> },
  ] },
]
