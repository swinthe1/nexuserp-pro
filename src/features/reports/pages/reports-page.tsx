import { ArrowRight, BarChart3, FileBarChart, Scale, Wallet } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { Card } from '@/components/ui/card'
import { t } from '@/i18n'
import { AREA_LABEL, REPORTS, canRunReport, type ReportDef } from '../catalog'

const AREAS: ReportDef['area'][] = ['Sales', 'Purchasing', 'Stock', 'Finance and tax', 'People', 'Production']

export function ReportsPage() {
  const { can } = useCompany()
  const runnable = REPORTS.filter((r) => canRunReport(can, r))
  const statements = [
    can('finance.read') && { href: '/finance/reports', title: t('Financial statements'), question: t('Profit and loss, balance sheet, cash flow and trial balance, with comparisons.'), icon: Scale },
    can('invoicing.read') && { href: '/finance/receivables', title: t('Receivables aging'), question: t('Every customer balance in 30-day buckets.'), icon: Wallet },
    can('invoicing.read') && { href: '/finance/payables', title: t('Payables aging'), question: t('What we owe each vendor, and when it is due.'), icon: Wallet },
    can('tax.read') && { href: '/tax/books', title: t('Sales and purchase books'), question: t('The official VAT books, laid out as the tax authority asks.'), icon: FileBarChart },
  ].filter(Boolean) as { href: string; title: string; question: string; icon: typeof Scale }[]

  return (
    <>
      <PageHeader title={t('Reports')} description={t('Pick a question. Click any row to see what makes it up, and export to Excel, CSV or PDF.')} />
      {!runnable.length && !statements.length && (
        <Card><EmptyState title={t('No reports for your role')} description={t('Reports follow your permissions. Ask a company admin if you need sales, stock or finance figures.')} /></Card>
      )}
      <div className="grid gap-6">
        {AREAS.map((area) => {
          const list = runnable.filter((r) => r.area === area)
          const extra = area === 'Finance and tax' ? statements : []
          if (!list.length && !extra.length) return null
          return (
            <section key={area}>
              <h2 className="mb-2 text-sm font-semibold">{t(AREA_LABEL[area])}</h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {list.map((r) => <ReportCard key={r.key} href={`/reports/${r.key}`} title={t(r.title)} question={t(r.question)} icon={BarChart3} />)}
                {extra.map((s) => <ReportCard key={s.href} {...s} />)}
              </div>
            </section>
          )
        })}
      </div>
    </>
  )
}

function ReportCard({ href, title, question, icon: Icon }: { href: string; title: string; question: string; icon: typeof Scale }) {
  return (
    <Link to={href} className="group flex gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-ring/40 focus-visible:ring-2 focus-visible:ring-ring">
      <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2 text-sm font-medium">{title}<ArrowRight className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" /></span>
        <span className="mt-0.5 block text-[13px] text-muted-foreground">{question}</span>
      </span>
    </Link>
  )
}
