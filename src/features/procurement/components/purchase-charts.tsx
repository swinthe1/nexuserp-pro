import { ChartColumn, TrendingUp } from 'lucide-react'
import * as React from 'react'
import { C, MonthBars, TrendLines } from '@/components/charts'
import { ErrorState } from '@/components/error-state'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { projectMonth } from '@/features/sales/components/sales-charts'
import { formatDateWith, t } from '@/i18n'
import { num } from '@/lib/utils'
import { usePurchaseMonths } from '../api'

const monthDate = (m: string) => new Date(`${m.slice(0, 7)}-01T00:00:00`)

/** the purchases by month against the same month last year, and as a trend */
export function PurchaseCharts({ to, currency }: { to: string; currency?: string | null }) {
  const q = usePurchaseMonths(to)
  const [tab, setTab] = React.useState('months')
  const ms = q.data ?? []
  const last12 = ms.slice(-12)
  const first = ms.findIndex((m) => num(m.spend) !== 0)
  const rows = last12.map((m, i) => {
    const gi = ms.length - 12 + i, prev = ms[gi - 12], v = num(m.spend)
    const lyOk = !!prev && first >= 0 && gi - 12 >= first
    return { key: m.month, label: formatDateWith(monthDate(m.month), { month: 'short' }), title: formatDateWith(monthDate(m.month), { month: 'long', year: 'numeric' }),
      values: { spend: v } as Record<string, number>, ly: lyOk ? num(prev.spend) : null, projected: projectMonth(m.month, v),
      a: first < 0 || gi < first ? null : v, b: lyOk ? num(prev.spend) : null }
  })
  const year = monthDate(to).getFullYear()
  const body = (node: React.ReactNode) => q.isLoading ? <Skeleton className="h-64" /> : q.isError ? <ErrorState compact error={q.error} onRetry={() => void q.refetch()} /> : node
  return (
    <Card>
      <Tabs value={tab} onValueChange={setTab}>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div className="grid gap-1"><CardTitle>{t('Spend by month')}</CardTitle>
            <CardDescription>{tab === 'months' ? t('Last 12 months, {currency} without VAT. The black line is the same month last year.', { currency: currency ?? '' }) : t('This year against last year, month by month, {currency} without VAT.', { currency: currency ?? '' })}</CardDescription></div>
          <TabsList>
            <TabsTrigger value="months"><ChartColumn />{t('Months|chart')}</TabsTrigger>
            <TabsTrigger value="trend"><TrendingUp />{t('Trend')}</TabsTrigger>
          </TabsList>
        </CardHeader>
        <CardContent>
          <TabsContent value="months" className="mt-0">{body(<MonthBars parts={[{ key: 'spend', label: t('Spend (without VAT)'), color: C.one }]} rows={rows} currency={currency} height={240} />)}</TabsContent>
          <TabsContent value="trend" className="mt-0">{body(<TrendLines rows={rows} currency={currency} aLabel={String(year)} bLabel={String(year - 1)} height={260} />)}</TabsContent>
        </CardContent>
      </Tabs>
    </Card>
  )
}
