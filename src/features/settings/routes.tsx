import type { RouteObject } from 'react-router-dom'
import { lazyPage, RequirePerm } from '@/app/require-perm'

const CompanySettingsPage = lazyPage(() => import('./pages/company-settings-page'), 'CompanySettingsPage')
const UsersPage = lazyPage(() => import('./pages/users-page'), 'UsersPage')
const RolesPage = lazyPage(() => import('./pages/roles-page'), 'RolesPage')
const WorkflowsPage = lazyPage(() => import('./pages/workflows-page'), 'WorkflowsPage')
const NumberingPage = lazyPage(() => import('./pages/numbering-page'), 'NumberingPage')
const AuditPage = lazyPage(() => import('./pages/audit-page'), 'AuditPage')
const ImportPage = lazyPage(() => import('./pages/import-page'), 'ImportPage')
const MigrationPage = lazyPage(() => import('./pages/migration-page'), 'MigrationPage')
const AutomationPage = lazyPage(() => import('./pages/automation-page'), 'AutomationPage')
const NotificationsPage = lazyPage(() => import('./pages/notifications-page'), 'NotificationsPage')

export const settingsRoutes: RouteObject[] = [
  { path: 'settings/audit', element: <RequirePerm perm="audit.read" />, children: [{ index: true, element: <AuditPage /> }] },
  { path: 'settings/automation', element: <RequirePerm perm="core.read" />, children: [{ index: true, element: <AutomationPage /> }] },
  { path: 'settings/import', element: <RequirePerm perm="core.read" />, children: [{ index: true, element: <ImportPage /> }] },
  { path: 'settings', element: <RequirePerm perm="admin.read" />, children: [
    { index: true, element: <CompanySettingsPage /> },
    { path: 'users', element: <UsersPage /> },
    { path: 'roles', element: <RolesPage /> },
    { path: 'workflows', element: <WorkflowsPage /> },
    { path: 'numbering', element: <NumberingPage /> },
    { path: 'migration', element: <MigrationPage /> },
  ] },
]

export const notificationsRoutes: RouteObject[] = [
  { path: 'notifications', element: <RequirePerm perm="core.read" />, children: [{ index: true, element: <NotificationsPage /> }] },
]
