import { PageStack, ToSection } from '@/components/page-stack'
import { msg } from '@/i18n'
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
      { path: 'books', element: <PageStack sections={[
        { id: 'books', label: msg('VAT books|menu'), element: <VatBooksPage /> },
        { id: 'declarations', label: msg('VAT declarations'), element: <DeclarationsPage /> }]} /> },
      { path: 'declarations', element: <ToSection to="/tax/books" section="declarations" alone={<DeclarationsPage />} /> },
      { path: 'declarations/:id', element: <DeclarationPage key="decl" /> },
      { path: 'fiscalization', element: <FiscalMonitorPage /> },
      { path: 'codes', element: <TaxCodesPage /> },
      { path: 'withholding', element: <ToSection to="/tax/income-tax" section="withholding" alone={<WithholdingPage />} /> },
      { path: 'income-tax', element: <PageStack sections={[
        { id: 'income', label: msg('Corporate income tax'), element: <IncomeTaxPage /> },
        { id: 'withholding', label: msg('Withholding tax'), element: <WithholdingPage /> },
        { id: 'small', label: msg('Small business tax'), element: <SmallBusinessPage /> }]} /> },
      { path: 'small-business', element: <ToSection to="/tax/income-tax" section="small" alone={<SmallBusinessPage />} /> },
    ],
  },
]
