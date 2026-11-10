import { CalendarDays, ChartColumn, Clock, LayoutList, TrendingUp } from 'lucide-react'
import * as React from 'react'
import { C, CategoryBars, DayCalendar, HourHeatmap, MonthBars, TrendLines, type MonthRow } from '@/components/charts'
import { ErrorState } from '@/components/error-state'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDateWith, t, td } from '@/i18n'
import { num } from '@/lib/utils'
import { useSalesCharts, useSalesDaily } from '../api'

const pad = (n: number) => String(n).padStart(2, '0')
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const monthDate = (m: string) => new Date(`${m.slice(0, 7)}-01T00:00:00`)

/** the month still running: what it comes to by its last day at the pace so far */
export function projectMonth(month: string, value: number) {
  const now = new Date(), m = monthDate(month)
  if (m.getFullYear() !== now.getFullYear() || m.getMonth() !== now.getMonth() || value <= 0) return null
  const days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate()
  return now.getDate() >= days ? null : (value / now.getDate()) * days
}

const TAB_KEY = 'drispro.sales-charts.tab'

/**
 * The sales in pictures, under the figures and the analysis (never above them): the months against last year,
 * the trend, the days of the month, the busy hours and the categories. One card, a tab for each.
 */
export function SalesCharts({ to, currency }: { to: string; currency?: string | null }) {
  const charts = useSalesCharts(to)
  const m0 = `${to.slice(0, 7)}-01`
  const mEnd = (() => { const d = monthDate(m0); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0); const today = new Date(); return isoDay(last < today ? last : today) })()
  const [tab, setTab] = React.useState(() => { try { return localStorage.getItem(TAB_KEY) ?? 'months' } catch { return 'months' } })
  const days = useSalesDaily(m0, mEnd, tab === 'days')
  const pick = (v: string) => { setTab(v); try { localStorage.setItem(TAB_KEY, v) } catch { /* private window */ } }
  const d = charts.data

  const ms = d?.months ?? []
  const both = ms.some((m) => num(m.invoices) !== 0) && ms.some((m) => num(m.till) !== 0)
  const parts = both
    ? [{ key: 'till', label: t('At the tills'), color: C.one }, { key: 'invoices', label: t('On invoices'), color: C.two }]
    : [{ key: 'net', label: t('Sales (without VAT)'), color: C.one }]
  const last12 = ms.slice(-12)
  const rows: MonthRow[] = last12.map((m, i) => {
    const till = num(m.till), inv = num(m.invoices), net = till + inv
    const prev = ms[ms.length - 24 + i]
    return {
      key: m.month, label: formatDateWith(monthDate(m.month), { month: 'short' }),
      title: formatDateWith(monthDate(m.month), { month: 'long', year: 'numeric' }),
      values: (both ? { till, invoices: inv } : { net }) as Record<string, number>,
      ly: prev ? num(prev.till) + num(prev.invoices) : null,
      projected: projectMonth(m.month, net),
      margin: m.cost != null && net > 0 ? ((net - num(m.cost)) / net) * 100 : null,
    }
  })
  // the months before the first sale are not zero sales: nothing was recorded yet
  const first = ms.findIndex((m) => num(m.till) + num(m.invoices) !== 0)
  const trend = last12.map((m, i) => {
    const gi = ms.length - 12 + i, prev = ms[gi - 12]
    const net = num(m.till) + num(m.invoices)
    return { key: m.month, label: formatDateWith(monthDate(m.month), { month: 'short' }), title: formatDateWith(monthDate(m.month), { month: 'long', year: 'numeric' }),
      a: first < 0 || gi < first ? null : net, b: prev && first >= 0 && gi - 12 >= first ? num(prev.till) + num(prev.invoices) : null, projected: projectMonth(m.month, net) }
  })
  const year = monthDate(m0).getFullYear()
  const monthName = formatDateWith(monthDate(m0), { month: 'long', year: 'numeric' })
  const desc: Record<string, string> = {
    months: t('Last 12 months, {currency} without VAT. The black line is the same month last year.', { currency: currency ?? '' }),
    trend: t('This year against last year, month by month, {currency} without VAT.', { currency: currency ?? '' }),
    days: t('Each day of {month}: the darker, the more was sold (without VAT).', { month: monthName }),
    hours: t('What the tills sell on average in each hour of each weekday, {month}, without VAT.', { month: monthName }),
    categories: t('What each category sold in {month} and what it earns, without VAT.', { month: monthName }),
  }
  const body = (node: React.ReactNode, h = 'h-72') => charts.isLoading ? <Skeleton className={h} /> : charts.isError ? <ErrorState compact error={charts.error} onRetry={() => void charts.refetch()} /> : node
  return (
    <Card>
      <Tabs value={tab} onValueChange={pick}>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div className="grid gap-1"><CardTitle>{t('Sales in charts')}</CardTitle><CardDescription>{desc[tab]}</CardDescription></div>
          <TabsList>
            <TabsTrigger value="months"><ChartColumn />{t('Months|chart')}</TabsTrigger>
            <TabsTrigger value="trend"><TrendingUp />{t('Trend')}</TabsTrigger>
            <TabsTrigger value="days"><CalendarDays />{t('Days|chart')}</TabsTrigger>
            <TabsTrigger value="hours"><Clock />{t('Hours|chart')}</TabsTrigger>
            <TabsTrigger value="categories"><LayoutList />{t('Categories')}</TabsTrigger>
          </TabsList>
        </CardHeader>
        <CardContent>
          <TabsContent value="months" className="mt-0">{body(<MonthBars parts={parts} rows={rows} currency={currency} />)}</TabsContent>
          <TabsContent value="trend" className="mt-0">{body(<TrendLines rows={trend} currency={currency} aLabel={String(year)} bLabel={String(year - 1)} />)}</TabsContent>
          <TabsContent value="days" className="mt-0">
            {days.isLoading ? <Skeleton className="h-72" /> : days.isError ? <ErrorState compact error={days.error} onRetry={() => void days.refetch()} />
              : <DayCalendar month={m0} currency={currency} days={(days.data ?? []).map((x) => ({ d: x.d, value: num(x.till) + num(x.invoices) }))} />}
          </TabsContent>
          <TabsContent value="hours" className="mt-0">{body(<HourHeatmap cells={(d?.hours ?? []).map((h) => ({ dow: h.dow, hour: h.hour, net: num(h.net) }))} dowDays={d?.dow_days ?? {}} currency={currency} />)}</TabsContent>
          <TabsContent value="categories" className="mt-0">{body(<CategoryBars currency={currency} rows={(d?.categories ?? []).map((c) => ({ name: c.name ? td(c.name) : t('No category'), net: num(c.net), cost: c.cost == null ? null : num(c.cost) }))} />)}</TabsContent>
        </CardContent>
      </Tabs>
    </Card>
  )
}
