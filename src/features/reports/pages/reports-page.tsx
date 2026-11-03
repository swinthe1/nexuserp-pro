import { ArrowRight, BarChart3, Bookmark, FileBarChart, Gauge, Scale, Trash2, Users, Wallet } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/app/auth-provider'
import { useCompany } from '@/app/company-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { Card } from '@/components/ui/card'
import { t } from '@/i18n'
import { AREA_LABEL, REPORTS, canRunReport, reportDef, type ReportDef } from '../catalog'
import { useDeleteReport, useSavedReports } from '../api'
import { savedHref } from './report-page'

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
  const panel = can('sales.read') && can('reports.read')
    ? [{ href: '/reports/kpi', title: t('Manager\'s panel'), question: t('Are we on plan? Customers, average receipt, margin, losses, stock turnover and the tills, against the period before.'), icon: Gauge }] : []

  return (
    <>
      <PageHeader title={t('Reports')} description={t('Pick a question. Click any row to see what makes it up, and export to Excel, CSV or PDF.')} />
      {!runnable.length && !statements.length && !panel.length && (
        <Card><EmptyState title={t('No reports for your role')} description={t('Reports follow your permissions. Ask a company admin if you need sales, stock or finance figures.')} /></Card>
      )}
      <div className="grid gap-6">
        <MyReports />
        {AREAS.map((area) => {
          const list = runnable.filter((r) => r.area === area)
          const extra = area === 'Finance and tax' ? statements : area === 'Sales' ? panel : []
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

function MyReports() {
  const { can } = useCompany()
  const { user } = useAuth()
  const list = useSavedReports()
  const del = useDeleteReport()
  const mine = (list.data ?? []).filter((r) => { const d = reportDef(r.report); return d && canRunReport(can, d) })
  if (!mine.length) return null
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold">{t('My reports')}</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {mine.map((r) => (
          <div key={r.id} className="group relative flex gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-ring/40">
            <Bookmark className="mt-0.5 size-4 shrink-0 text-primary" />
            <Link to={savedHref(r)} className="min-w-0 flex-1 after:absolute after:inset-0 focus-visible:outline-none">
              <span className="block truncate text-sm font-medium">{r.name}</span>
              <span className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted-foreground">
                {t(reportDef(r.report)!.title)}{r.is_shared && <><span aria-hidden>·</span><Users className="size-3" aria-label={t('Shared')} /></>}
              </span>
            </Link>
            {r.owner_id === user?.id && (
              <ConfirmDialog
                trigger={<Button variant="ghost" size="icon" className="relative z-10 size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label={t('Delete')}><Trash2 className="size-3.5" /></Button>}
                title={t('Delete "{name}"?', { name: r.name })} description={t('Only the saved setup goes; the figures stay in the books.')}
                confirmLabel={t('Delete')} destructive onConfirm={() => del.mutateAsync(r.id)} />
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
