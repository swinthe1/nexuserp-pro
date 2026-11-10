import {
  Archive, BadgeDollarSign, BookOpen, Bookmark, Boxes, ChevronRight, Factory, HandCoins, Landmark, LineChart, PiggyBank, Scale, Search,
  ShoppingCart, Trash2, TrendingUp, Users, Wallet, type LucideIcon,
} from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/app/auth-provider'
import { useCompany } from '@/app/company-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { msg, t } from '@/i18n'
import { cn } from '@/lib/utils'
import { REPORTS, canRunReport, reportDef } from '../catalog'
import { useDeleteReport, useSavedReports } from '../api'
import { savedHref } from './report-page'

/** one report: where it opens, what it answers, and who may open it */
type Item = { href: string; title: string; question: string; ok: (can: (p: string) => boolean) => boolean }
/** a group of reports, named by the question people come with */
type Group = { key: string; title: string; question: string; icon: LucideIcon; hue: string; items: Item[] }

const run = (key: string) => (can: (p: string) => boolean) => { const d = reportDef(key); return !!d && canRunReport(can, d) }
const perm = (p: string) => (can: (p: string) => boolean) => can(p)
const def = (key: string) => REPORTS.find((r) => r.key === key)!

const GROUPS: Group[] = [
  { key: 'sales', title: msg('Sales'), question: msg('How much did we sell, what and to whom?'), icon: TrendingUp, hue: '204 82%', items: [
    { href: '/reports/sales', title: def('sales').title, question: msg('By month, group, item or customer, tills and invoices together; click a row to go deeper.'), ok: run('sales') },
    { href: '/reports/sales-detail', title: msg('Detailed sales'), question: msg('A list of every sale by item, receipt, customer, unit, cashier, day or hour, with margin and filters.'), ok: perm('sales.read') },
    { href: '/reports/analysis', title: msg('Compare two periods'), question: msg('This month against last month or last year, by unit, group, supplier or item.'), ok: perm('sales.read|procurement.read') },
    { href: '/reports/kpi', title: msg('Manager\'s panel'), question: msg('Are we on plan? Customers, average receipt, margin, losses and stock turnover.'), ok: (can) => can('sales.read') && can('reports.read') },
    { href: '/pos/history', title: msg('Till receipts'), question: msg('Every receipt of every till, to find one or print it again.'), ok: perm('pos.read') },
    { href: '/finance/z-reports', title: msg('Z reports'), question: msg('The closing report of each fiscal till, day by day.'), ok: perm('invoicing.read') },
  ] },
  { key: 'profit', title: msg('Profit'), question: msg('How much did we earn?'), icon: PiggyBank, hue: '152 68%', items: [
    { href: '/reports/margin', title: def('margin').title, question: msg('Which items, groups and customers bring the most after what the goods cost.'), ok: run('margin') },
    { href: '/reports/profit', title: msg('Profit report'), question: msg('Sales, cost of goods and expenses down to the net profit, by month or by unit.'), ok: perm('finance.read|reports.read') },
    { href: '/finance/reports', title: msg('Financial statements'), question: msg('Profit and loss, balance sheet, cash flow and trial balance, with comparisons.'), ok: perm('finance.read') },
  ] },
  { key: 'stock', title: msg('Stock'), question: msg('What do we have, what is it worth and what is not moving?'), icon: Boxes, hue: '32 90%', items: [
    { href: '/inventory/stock-report', title: msg('Stock report'), question: msg('The stock on any day, at cost or at selling price, as a price list or a sheet to sign.'), ok: perm('inventory.read') },
    { href: '/reports/inventory', title: def('inventory').title, question: msg('What the stock is worth by unit and group on a chosen day.'), ok: run('inventory') },
    { href: '/reports/stock_aging', title: def('stock_aging').title, question: msg('Goods that have not moved for 30, 90 or 180 days, and what they are worth.'), ok: run('stock_aging') },
    { href: '/inventory/abc', title: msg('ABC analysis'), question: msg('Which items carry the sales (A) and which hardly sell (C).'), ok: perm('inventory.read') },
    { href: '/inventory/shrinkage', title: msg('Shrinkage|menu'), question: msg('What was lost, broken or thrown away, by reason and by item.'), ok: perm('inventory.read') },
    { href: '/inventory/expiry', title: msg('Expiry'), question: msg('Goods that expire soon or have expired, by lot.'), ok: perm('inventory.read') },
    { href: '/inventory/item-card', title: msg('Item card'), question: msg('Every movement of one item: in, out, at what cost and by which document.'), ok: perm('inventory.read') },
  ] },
  { key: 'buying', title: msg('Buying'), question: msg('What did we buy and from whom?'), icon: ShoppingCart, hue: '262 60%', items: [
    { href: '/reports/purchases', title: def('purchases').title, question: msg('By month, supplier, group or item, with the VAT on it.'), ok: run('purchases') },
    { href: '/reports/purchases-detail', title: msg('Detailed purchases'), question: msg('Every purchase line with both discounts, import costs and filters.'), ok: perm('procurement.read|invoicing.read') },
    { href: '/procurement/scorecard', title: msg('Vendor scorecard'), question: msg('Which suppliers deliver on time, complete and at the agreed price.'), ok: perm('procurement.read') },
    { href: '/procurement/pending-invoices', title: msg('Goods waiting for the invoice|menu'), question: msg('Goods received whose supplier invoice is not entered yet.'), ok: perm('invoicing.read|procurement.read') },
  ] },
  { key: 'money', title: msg('Money and debts'), question: msg('Who owes us, whom do we owe, and will the money be enough?'), icon: Wallet, hue: '188 78%', items: [
    { href: '/finance/receivables', title: msg('Receivables aging'), question: msg('What each customer owes, split into 30-day steps.'), ok: perm('invoicing.read') },
    { href: '/finance/payables', title: msg('Payables aging'), question: msg('What we owe each supplier, and when it is due.'), ok: perm('invoicing.read') },
    { href: '/finance/cash-forecast', title: msg('Cash forecast'), question: msg('The money coming in and going out in the weeks ahead.'), ok: perm('finance.read') },
    { href: '/finance/cash-book', title: msg('Cash book|ledger'), question: msg('Every cash movement in and out, day by day.'), ok: perm('finance.read') },
  ] },
  { key: 'tax', title: msg('Taxes'), question: msg('What goes to the tax office?'), icon: Scale, hue: '354 70%', items: [
    { href: '/tax/books', title: msg('Sales and purchase books'), question: msg('The official VAT books, laid out as the tax authority asks.'), ok: perm('tax.read') },
    { href: '/reports/vat', title: def('vat').title, question: msg('Output and input VAT by month and treatment.'), ok: run('vat') },
    { href: '/tax/declarations', title: msg('VAT declarations'), question: msg('The monthly declarations: drafts, filed and their result.'), ok: perm('tax.read') },
  ] },
  { key: 'people', title: msg('People and production'), question: msg('What do salaries and production cost?'), icon: Factory, hue: '220 14%', items: [
    { href: '/reports/payroll', title: def('payroll').title, question: msg('Salaries with contributions, by month, department and person.'), ok: run('payroll') },
    { href: '/reports/production', title: def('production').title, question: msg('What closed work orders cost against the plan.'), ok: run('production') },
  ] },
]

/** the first questions most people come with, as big tiles */
const FAVOURITES: { href: string; title: string; question: string; icon: LucideIcon; hue: string; ok: (can: (p: string) => boolean) => boolean }[] = [
  { href: '/reports/sales', title: msg('How much did we sell?'), question: msg('Sales analysis, tills and invoices'), icon: TrendingUp, hue: '204 82%', ok: run('sales') },
  { href: '/reports/margin', title: msg('Where do we earn most?'), question: msg('Margin by item and customer'), icon: PiggyBank, hue: '152 68%', ok: run('margin') },
  { href: '/inventory/stock-report', title: msg('What is the stock worth?'), question: msg('The stock on any day'), icon: Boxes, hue: '32 90%', ok: perm('inventory.read') },
  { href: '/finance/receivables', title: msg('Who owes us?'), question: msg('Customers by how late they are'), icon: HandCoins, hue: '188 78%', ok: perm('invoicing.read') },
]

/** the overviews of each part of the program */
const OVERVIEWS: { href: string; title: string; icon: LucideIcon; perm: string }[] = [
  { href: '/sales', title: msg('Sales overview|menu'), icon: BadgeDollarSign, perm: 'sales.read' },
  { href: '/procurement', title: msg('Purchasing overview|menu'), icon: LineChart, perm: 'procurement.read' },
  { href: '/finance', title: msg('Finance overview|menu'), icon: Landmark, perm: 'finance.read' },
  { href: '/tax', title: msg('Tax overview|menu'), icon: BookOpen, perm: 'tax.read' },
  { href: '/history', title: msg('History from the old program'), icon: Archive, perm: 'invoicing.read' },
]

/** words compared without accents or case, so "fature" finds "Faturë" */
const plain = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

export function ReportsPage() {
  const { can, pageAllowed } = useCompany()
  const [q, setQ] = React.useState('')
  const fromReports = { backTo: { href: '/reports', label: t('Reports') } }
  const want = plain(q.trim())
  const allowed = (href: string, ok: (c: typeof can) => boolean) => ok(can) && pageAllowed(href)
  const match = (...texts: string[]) => !want || texts.some((x) => plain(t(x)).includes(want))
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => allowed(i.href, i.ok) && match(i.title, i.question, g.title)) })).filter((g) => g.items.length)
  const favourites = FAVOURITES.filter((f) => allowed(f.href, f.ok))
  const overviews = OVERVIEWS.filter((o) => can(o.perm) && pageAllowed(o.href) && match(o.title))
  const nothing = !groups.length && !overviews.length

  return (
    <>
      <PageHeader title={t('Reports')} description={t('Start from your question. Every report opens with its filters and goes to Excel or PDF.')}
        actions={<div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Find a report…')} aria-label={t('Find a report…')} className="pl-8" />
        </div>} />

      {!want && favourites.length > 0 && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {favourites.map((f) => (
            <Link key={f.href} to={f.href} state={fromReports} style={{ '--mod': f.hue } as React.CSSProperties}
              className="stat-card group flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-card transition-[border-color,transform] hover:-translate-y-px hover:border-primary/30 focus-visible:ring-2 focus-visible:ring-ring">
              <span className="mod-chip flex size-10 items-center justify-center rounded-[10px]"><f.icon className="size-5" /></span>
              <span>
                <span className="block text-[15px] font-bold leading-snug">{t(f.title)}</span>
                <span className="mt-0.5 flex items-center gap-1 text-[13px] text-muted-foreground">{t(f.question)}<ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" /></span>
              </span>
            </Link>
          ))}
        </div>
      )}

      {!want && <MyReports />}

      {nothing && (
        <Card>{want
          ? <EmptyState title={t('No report matches "{q}"', { q })} description={t('Try another word, e.g. "stock", "VAT" or "customer".')} />
          : <EmptyState title={t('No reports for your role')} description={t('Reports follow your permissions. Ask a company admin if you need sales, stock or finance figures.')} />}</Card>
      )}

      <div className="gap-4 lg:columns-2">
        {groups.map((g) => (
          <section key={g.key} style={{ '--mod': g.hue } as React.CSSProperties} className="mb-4 break-inside-avoid overflow-hidden rounded-xl border bg-card shadow-card">
            <header className="flex items-center gap-3 border-b px-4 py-3">
              <span className="mod-chip flex size-9 shrink-0 items-center justify-center rounded-[10px]"><g.icon className="size-[18px]" /></span>
              <span className="min-w-0">
                <h2 className="text-[15px] font-bold leading-tight">{t(g.title)}</h2>
                <p className="text-[13px] text-muted-foreground">{t(g.question)}</p>
              </span>
            </header>
            <ul className="divide-y">
              {g.items.map((i) => (
                <li key={i.href}>
                  <Link to={i.href} state={fromReports} className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-semibold">{t(i.title)}</span>
                      <span className="block text-[12.5px] leading-snug text-muted-foreground">{t(i.question)}</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {overviews.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-[13px] font-semibold text-muted-foreground">{t('Overviews of each part')}</h2>
          <div className="flex flex-wrap gap-2">
            {overviews.map((o) => <Button key={o.href} variant="outline" size="sm" asChild><Link to={o.href} state={fromReports}><o.icon /> {t(o.title)}</Link></Button>)}
          </div>
        </section>
      )}
    </>
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
    <section className="mb-6">
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Bookmark className="size-4 text-primary" /> {t('My reports')}</h2>
      <div className="flex flex-wrap gap-2">
        {mine.map((r) => (
          <span key={r.id} className={cn('group inline-flex items-center gap-1 rounded-full border bg-card py-1 pl-3 pr-1 text-[13px] transition-colors hover:border-ring/40')}>
            <Link to={savedHref(r)} state={{ backTo: { href: '/reports', label: t('Reports') } }} className="font-medium hover:underline">{r.name}</Link>
            <span className="text-muted-foreground">· {t(reportDef(r.report)!.title)}</span>
            {r.is_shared && <Users className="size-3 text-muted-foreground" aria-label={t('Shared')} />}
            {r.owner_id === user?.id && (
              <ConfirmDialog
                trigger={<Button variant="ghost" size="icon" className="size-6 rounded-full" aria-label={t('Delete')}><Trash2 className="size-3" /></Button>}
                title={t('Delete "{name}"?', { name: r.name })} description={t('Only the saved setup goes; the figures stay in the books.')}
                confirmLabel={t('Delete')} destructive onConfirm={() => del.mutateAsync(r.id)} />
            )}
          </span>
        ))}
      </div>
    </section>
  )
}

