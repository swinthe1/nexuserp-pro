import type { RouteObject } from 'react-router-dom'
import { lazyPage, RequirePerm } from '@/app/require-perm'

const HrOverviewPage = lazyPage(() => import('./pages/hr-overview-page'), 'HrOverviewPage')
const EmployeesPage = lazyPage(() => import('./pages/employees-page'), 'EmployeesPage')
const EmployeePage = lazyPage(() => import('./pages/employees-page'), 'EmployeePage')
const LeavePage = lazyPage(() => import('./pages/leave-page'), 'LeavePage')
const AttendancePage = lazyPage(() => import('./pages/attendance-page'), 'AttendancePage')
const PayrollRunsPage = lazyPage(() => import('./pages/payroll-page'), 'PayrollRunsPage')
const PayrollRunPage = lazyPage(() => import('./pages/payroll-page'), 'PayrollRunPage')
const MePage = lazyPage(() => import('./pages/me-page'), 'MePage')
const HrSetupPage = lazyPage(() => import('./pages/hr-setup-page'), 'HrSetupPage')

export const hrRoutes: RouteObject[] = [
  { path: 'hr/me', element: <RequirePerm perm="core.read" />, children: [{ index: true, element: <MePage /> }] },
  { path: 'hr/payroll', element: <RequirePerm perm="payroll.read" />, children: [
    { index: true, element: <PayrollRunsPage /> },
    { path: ':id', element: <PayrollRunPage /> },
  ] },
  { path: 'hr', element: <RequirePerm perm="hr.read" />, children: [
    { index: true, element: <HrOverviewPage /> },
    { path: 'employees', element: <EmployeesPage /> },
    { path: 'employees/new', element: <EmployeePage key="new" /> },
    { path: 'employees/:id', element: <EmployeePage key="emp" /> },
    { path: 'leave', element: <LeavePage /> },
    { path: 'attendance', element: <AttendancePage /> },
    { path: 'setup', element: <HrSetupPage /> },
  ] },
]
