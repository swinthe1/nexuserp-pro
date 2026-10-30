import { msg } from '@/i18n'

export type ReportKey = 'sales' | 'margin' | 'purchases' | 'inventory' | 'stock_aging' | 'receivables' | 'vat' | 'payroll' | 'production'

export interface ReportDef {
  key: ReportKey
  title: string
  /** the question the report answers */
  question: string
  area: 'Sales' | 'Purchasing' | 'Stock' | 'Finance and tax' | 'People' | 'Production'
  perm: string
  /** drill order; clicking a row moves to the next dim not yet filtered */
  path: string[]
  /** the default grouping */
  start: string
  /** main measure for the chart */
  measure: string
  /** stock and receivables are a position at a date, not a period */
  asOf?: boolean
}

export const REPORTS: ReportDef[] = [
  { key: 'sales', title: msg('Sales analysis'), question: msg('What did we sell, to whom and when — invoices and tills together?'), area: msg('Sales'), perm: 'sales.read',
    path: ['month', 'category', 'product', 'customer', 'document'], start: 'month', measure: 'revenue' },
  { key: 'margin', title: msg('Margin by product'), question: msg('Which products and customers earn the most after cost of goods?'), area: msg('Sales'), perm: 'sales.read',
    path: ['category', 'product', 'customer', 'document'], start: 'category', measure: 'margin' },
  { key: 'purchases', title: msg('Purchase analysis'), question: msg('What did we buy, from which vendors, and how much VAT was on it?'), area: msg('Purchasing'), perm: 'procurement.read',
    path: ['month', 'vendor', 'category', 'product', 'document'], start: 'month', measure: 'amount' },
  { key: 'inventory', title: msg('Inventory valuation'), question: msg('What is our stock worth, per warehouse and category, on a given day?'), area: msg('Stock'), perm: 'inventory.read',
    path: ['warehouse', 'category', 'product'], start: 'warehouse', measure: 'value', asOf: true },
  { key: 'stock_aging', title: msg('Stock aging'), question: msg('How much stock has not moved for 30, 90 or 180 days?'), area: msg('Stock'), perm: 'inventory.read',
    path: ['age', 'category', 'product'], start: 'age', measure: 'value', asOf: true },
  { key: 'vat', title: msg('VAT summary'), question: msg('Output and input VAT by month and treatment, from the same entries as the VAT books.'), area: msg('Finance and tax'), perm: 'tax.read',
    path: ['month', 'treatment', 'partner', 'document'], start: 'month', measure: 'net_vat' },
  { key: 'payroll', title: msg('Payroll cost'), question: msg('What do salaries cost us per month, department and person?'), area: msg('People'), perm: 'payroll.read',
    path: ['month', 'department', 'employee'], start: 'month', measure: 'employer_cost' },
  { key: 'production', title: msg('Production cost'), question: msg('What did closed work orders cost against plan?'), area: msg('Production'), perm: 'manufacturing.read',
    path: ['month', 'product', 'document'], start: 'month', measure: 'actual_cost' },
]

/** English labels (translation keys) of the groupings; render with t() */
export const DIM_LABEL: Record<string, string> = {
  month: msg('Month'), customer: msg('Customer'), product: msg('Product'), category: msg('Category'), salesperson: msg('Salesperson'), channel: msg('Channel'), city: msg('City'),
  document: msg('Document'), vendor: msg('Vendor'), account: msg('Expense account'), warehouse: msg('Warehouse'), age: msg('Age'), department: msg('Department'), employee: msg('Employee'),
  treatment: msg('VAT treatment'), partner: msg('Partner'), bucket: msg('Overdue'),
}

/** English names (translation keys) of the report areas */
export const AREA_LABEL: Record<ReportDef['area'], string> = {
  'Sales': msg('Sales'), 'Purchasing': msg('Purchasing'), 'Stock': msg('Stock'), 'Finance and tax': msg('Finance and tax'), 'People': msg('People'), 'Production': msg('Production'),
}

export const reportDef = (key: string | undefined) => REPORTS.find((r) => r.key === key)

/** sales.read + (reports.read or the module's write permission), as run_report checks */
export function canRunReport(can: (p: string) => boolean, def: ReportDef) {
  const module = def.perm.split('.')[0]
  return can(def.perm) && (can('reports.read') || can(`${module}.write`))
}
