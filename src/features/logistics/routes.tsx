import { PageStack, ToSection } from '@/components/page-stack'
import { msg } from '@/i18n'
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
    { index: true, element: <PageStack sections={[
      { id: 'overview', label: msg('Logistics overview'), element: <LogisticsOverviewPage /> },
      { id: 'planning', label: msg('Delivery planning'), element: <PlanningPage /> },
      { id: 'shipments', label: msg('Shipments'), element: <ShipmentsPage /> }]} /> },
    { path: 'planning', element: <ToSection to="/logistics" section="planning" alone={<PlanningPage />} /> },
    { path: 'routes', element: <Navigate to="/logistics/planning" replace /> },
    { path: 'routes/:id', element: <RoutePage key="route" /> },
    { path: 'shipments', element: <ToSection to="/logistics" section="shipments" alone={<ShipmentsPage />} /> },
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
