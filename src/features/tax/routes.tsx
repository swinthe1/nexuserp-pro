import type { RouteObject } from 'react-router-dom'
import { lazyPage, RequirePerm } from '@/app/require-perm'

const TaxOverviewPage = lazyPage(() => import('./pages/tax-overview-page'), 'TaxOverviewPage')
const VatBooksPage = lazyPage(() => import('./pages/vat-books-page'), 'VatBooksPage')
const DeclarationsPage = lazyPage(() => import('./pages/declarations-page'), 'DeclarationsPage')
const DeclarationPage = lazyPage(() => import('./pages/declarations-page'), 'DeclarationPage')
const FiscalMonitorPage = lazyPage(() => import('./pages/fiscal-page'), 'FiscalMonitorPage')
const TaxCodesPage = lazyPage(() => import('./pages/tax-codes-page'), 'TaxCodesPage')
const WithholdingPage = lazyPage(() => import('./pages/withholding-page'), 'WithholdingPage')
const IncomeTaxPage = lazyPage(() => import('./pages/income-tax-page'), 'IncomeTaxPage')
const SmallBusinessPage = lazyPage(() => import('./pages/small-business-page'), 'SmallBusinessPage')

export const taxRoutes: RouteObject[] = [
  {
    path: 'tax',
    element: <RequirePerm perm="tax.read" />,
    children: [
      { index: true, element: <TaxOverviewPage /> },
      { path: 'books', element: <VatBooksPage /> },
      { path: 'declarations', element: <DeclarationsPage /> },
      { path: 'declarations/:id', element: <DeclarationPage key="decl" /> },
      { path: 'fiscalization', element: <FiscalMonitorPage /> },
      { path: 'codes', element: <TaxCodesPage /> },
      { path: 'withholding', element: <WithholdingPage /> },
      { path: 'income-tax', element: <IncomeTaxPage /> },
      { path: 'small-business', element: <SmallBusinessPage /> },
    ],
  },
]
