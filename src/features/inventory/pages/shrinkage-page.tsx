import { Download } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { t, td, tEnum } from '@/i18n'
import { downloadCsv } from '@/lib/export'
import { cn, formatMoney, formatQty, num, todayISO } from '@/lib/utils'
import { useShrinkage, type ShrinkRow } from '@/features/wms/api'

const yearStart = () => `${todayISO().slice(0, 4)}-01-01`
type By = 'item' | 'reason' | 'unit' | 'category'

/** What went missing or turned up, from counts, damage, theft, expiry and corrections, with its value */
export function ShrinkagePage() {
  const { company } = useCompany()
  const [from, setFrom] = React.useState(yearStart())
  const [to, setTo] = React.useState(todayISO())
  const [by, setBy] = React.useState<By>('item')
  const q = useShrinkage(from, to)
  const rows = q.data ?? []
  const cur = company?.base_currency
  const lost = rows.reduce((s, r) => s + num(r.value_lost), 0)
  const found = rows.reduce((s, r) => s + num(r.value_found), 0)
  const reasons = [...new Set(rows.map((r) => r.reason))]

  const grouped = React.useMemo(() => {
    const key = (r: ShrinkRow) => by === 'item' ? r.variant_id : by === 'reason' ? r.reason : by === 'unit' ? (r.warehouse_id ?? '') : (r.category ?? '')
    const label = (r: ShrinkRow) => by === 'item' ? `${r.name}` : by === 'reason' ? tEnum(r.reason) : by === 'unit' ? td(r.warehouse ?? '—') : (r.category ?? t('No category'))
    const m = new Map<string, { label: string; sub: string; qty_lost: number; qty_found: number; value_lost: number; value_found: number; times: number; id: string }>()
    for (const r of rows) {
      const k = key(r)
      const g = m.get(k) ?? { label: label(r), sub: by === 'item' ? r.sku : '', qty_lost: 0, qty_found: 0, value_lost: 0, value_found: 0, times: 0, id: r.variant_id }
      g.qty_lost += num(r.qty_lost); g.qty_found += num(r.qty_found); g.value_lost += num(r.value_lost); g.value_found += num(r.value_found); g.times += r.adjustments
      m.set(k, g)
    }
    return [...m.values()].sort((a, b) => (b.value_lost - b.value_found) - (a.value_lost - a.value_found))
  }, [rows, by])

  const exportCsv = () => downloadCsv(`${t('shrinkage')}-${from}-${to}`, [
    [t('Reason'), t('Unit'), t('Code'), t('Item'), t('Category'), t('Missing'), t('Found'), t('Value missing'), t('Value found')],
    ...rows.map((r) => [tEnum(r.reason), td(r.warehouse ?? ''), r.sku, r.name, r.category ?? '', r.qty_lost, r.qty_found, r.value_lost, r.value_found]),
  ])

  return (
    <>
      <PageHeader title={t('Shrinkage|menu')}
        description={t('What went missing or turned up in stock: from counts, damage, theft, expiry and corrections, with its value at cost.')}
        actions={<>
          <div className="flex items-center gap-2"><Label htmlFor="sh-from" className="text-[13px] text-muted-foreground">{t('From')}</Label>
            <Input id="sh-from" type="date" className="w-[150px]" value={from} onChange={(e) => setFrom(e.target.value || yearStart())} /></div>
          <div className="flex items-center gap-2"><Label htmlFor="sh-to" className="text-[13px] text-muted-foreground">{t('To')}</Label>
            <Input id="sh-to" type="date" className="w-[150px]" value={to} onChange={(e) => setTo(e.target.value || todayISO())} /></div>
          <Button variant="outline" onClick={exportCsv} disabled={!rows.length}><Download /> {t('Export')}</Button>
        </>} />

      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.isLoading ? <Skeleton className="h-80" /> : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={t('Value missing')} tone={lost > 0 ? 'destructive' : 'default'} value={formatMoney(lost, cur)} />
            <StatCard label={t('Value found')} value={formatMoney(found, cur)} />
            <StatCard label={t('Net loss')} tone={lost - found > 0 ? 'destructive' : 'default'} value={formatMoney(lost - found, cur)} />
            <StatCard label={t('Most often')} value={reasons.length ? tEnum([...reasons].sort((a, b) => rows.filter((r) => r.reason === b).length - rows.filter((r) => r.reason === a).length)[0]!) : '—'} />
          </div>
          <Tabs value={by} onValueChange={(v) => setBy(v as By)} className="mb-3">
            <TabsList><TabsTrigger value="item">{t('By item')}</TabsTrigger><TabsTrigger value="reason">{t('By reason')}</TabsTrigger>
              <TabsTrigger value="unit">{t('By unit')}</TabsTrigger><TabsTrigger value="category">{t('By category')}</TabsTrigger></TabsList>
          </Tabs>
          <Card>
            <CardContent className="p-0">
              {!grouped.length ? <EmptyState compact title={t('Nothing missing in this period')} description={t('Stock counts and adjustments for damage, theft or expiry show up here once they are confirmed.')} /> : (
                <Table>
                  <TableHeader><TableRow className="hover:bg-transparent">
                    <TableHead>{by === 'item' ? t('Item') : by === 'reason' ? t('Reason') : by === 'unit' ? t('Units|places') : t('Category')}</TableHead>
                    <TableHead className="text-right">{t('Missing')}</TableHead><TableHead className="hidden text-right sm:table-cell">{t('Found')}</TableHead>
                    <TableHead className="text-right">{t('Net loss')}</TableHead><TableHead className="hidden text-right md:table-cell">{t('Times')}</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {grouped.map((g, i) => (
                      <TableRow key={i} className="hover:bg-transparent">
                        <TableCell className="max-w-[320px]">{by === 'item'
                          ? <Link to={`/inventory/item-card?v=${g.id}`} className="block truncate font-medium hover:underline">{g.label}</Link> : <span className="font-medium">{g.label}</span>}
                          {g.sub && <span className="block text-xs text-muted-foreground">{g.sub}</span>}</TableCell>
                        <TableCell className="text-right tabular">{by === 'item' && <span className="mr-2 text-xs text-muted-foreground">{formatQty(g.qty_lost)}</span>}{formatMoney(g.value_lost, cur)}</TableCell>
                        <TableCell className="hidden text-right tabular sm:table-cell">{by === 'item' && <span className="mr-2 text-xs text-muted-foreground">{formatQty(g.qty_found)}</span>}{formatMoney(g.value_found, cur)}</TableCell>
                        <TableCell className={cn('text-right font-medium tabular', g.value_lost - g.value_found > 0 && 'text-destructive')}>{formatMoney(g.value_lost - g.value_found, cur)}</TableCell>
                        <TableCell className="hidden text-right tabular md:table-cell">{g.times}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </>
  )
}
