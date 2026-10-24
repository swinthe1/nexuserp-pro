import { useQueries } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from 'zod'
import { Can, useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { SimpleFormDialog } from '@/components/simple-form-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ErrorState } from '@/components/error-state'
import { t } from '@/i18n'
import { cn, formatMoney, num, todayISO } from '@/lib/utils'
import { fetchBalances, finKeys, useCostCenters, useSaveCostCenter, type BalanceRow } from '../api'

const schema = z.object({
  code: z.string().trim().min(1, 'Enter a code').max(20),
  name: z.string().trim().min(1, 'Enter a name'),
  parent_id: z.string().nullable(),
  is_active: z.boolean(),
})
type Values = z.infer<typeof schema>
type CC = NonNullable<ReturnType<typeof useCostCenters>['data']>[number]

/** revenue, cost of sales and expenses for a set of balance rows (period movement, natural sign) */
export function plTotals(rows: BalanceRow[]) {
  let revenue = 0; let cogs = 0; let expenses = 0
  for (const r of rows) {
    const mv = num(r.debit) - num(r.credit)
    if (r.account_type === 'revenue') revenue -= mv
    else if (r.account_type === 'expense') { if (r.account_subtype === 'cogs') cogs += mv; else expenses += mv }
  }
  return { revenue, cogs, expenses, profit: revenue - cogs - expenses }
}

export function CostCentersPage() {
  const { companyId } = useCompany()
  const ccs = useCostCenters()
  const save = useSaveCostCenter()
  const [from, setFrom] = React.useState(`${new Date().getFullYear()}-01-01`)
  const [to, setTo] = React.useState(todayISO())
  const [edit, setEdit] = React.useState<CC | 'new' | null>(null)
  const list = ccs.data ?? []
  const results = useQueries({
    queries: [...list.map((c) => c.id), null].map((cc) => ({
      queryKey: [...finKeys.all(companyId), 'balances', from, to, cc ?? 'all'],
      queryFn: () => fetchBalances(companyId, from, to, cc),
      enabled: !!companyId && !!ccs.data,
    })),
  })
  const totals = results.map((r) => (r.data ? plTotals(r.data) : null))
  const all = totals[list.length]
  const zero = { revenue: 0, cogs: 0, expenses: 0, profit: 0 }
  const assigned = totals.slice(0, list.length).reduce<typeof zero>((s, x) => ({ revenue: s.revenue + num(x?.revenue), cogs: s.cogs + num(x?.cogs), expenses: s.expenses + num(x?.expenses), profit: s.profit + num(x?.profit) }), zero)
  const unassigned = all ? { revenue: all.revenue - assigned.revenue, cogs: all.cogs - assigned.cogs, expenses: all.expenses - assigned.expenses, profit: all.profit - assigned.profit } : null
  const loading = results.some((r) => r.isLoading)
  const nameOf = (id: string | null) => list.find((c) => c.id === id)?.name

  const current = edit === 'new' ? null : edit
  return (
    <>
      <PageHeader title={t('Cost centers')} description={t('Tag entries with a department, branch or project to see its own profit. Revenue and costs without a cost center are shown separately.')}
        actions={<>
          <div className="flex items-center gap-2 text-[13px]">
            <Label htmlFor="cc-from" className="text-muted-foreground">{t('From')}</Label><Input id="cc-from" type="date" className="w-[150px]" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Label htmlFor="cc-to" className="text-muted-foreground">{t('To')}</Label><Input id="cc-to" type="date" className="w-[150px]" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Can perm="finance.write"><Button onClick={() => setEdit('new')}><Plus /> {t('New cost center')}</Button></Can>
        </>} />
      <Card>
        <CardContent className="overflow-x-auto p-0">
          {ccs.isLoading ? <Skeleton className="m-4 h-40" /> : ccs.isError ? <ErrorState error={ccs.error} onRetry={() => void ccs.refetch()} /> : !list.length ? (
            <EmptyState title={t('No cost centers yet')} description={t('Create one per department or branch, then choose it on entries, assets and documents.')}
              action={<Can perm="finance.write"><Button size="sm" onClick={() => setEdit('new')}><Plus /> {t('New cost center')}</Button></Can>} />
          ) : (
            <Table>
              <TableHeader><TableRow className="hover:bg-transparent">
                <TableHead>{t('Cost center')}</TableHead><TableHead>{t('Belongs to')}</TableHead>
                <TableHead className="text-right">{t('Revenue')}</TableHead><TableHead className="text-right">{t('Cost of goods sold')}</TableHead><TableHead className="text-right">{t('Expenses')}</TableHead>
                <TableHead className="text-right">{t('Profit')}</TableHead><TableHead className="text-right">{t('Margin')}</TableHead><TableHead className="w-[1%]" />
              </TableRow></TableHeader>
              <TableBody>
                {list.map((c, i) => <PLRow key={c.id} label={<><span className="font-mono text-xs text-muted-foreground">{c.code}</span> <span className="font-medium">{c.name}</span>{!c.is_active && <Badge variant="secondary" className="ml-2">{t('Inactive')}</Badge>}</>}
                  parent={nameOf(c.parent_id)} tot={totals[i]} loading={loading} href={`/finance/reports?tab=pl&cc=${c.id}&from=${from}&to=${to}`}
                  action={<Can perm="finance.write"><Button size="sm" variant="ghost" onClick={() => setEdit(c)}>{t('Edit')}</Button></Can>} />)}
                {unassigned && (Math.abs(unassigned.revenue) + Math.abs(unassigned.expenses) + Math.abs(unassigned.cogs) > 0.005) &&
                  <PLRow label={<span className="text-muted-foreground">{t('No cost center')}</span>} tot={unassigned} loading={loading} />}
              </TableBody>
              <TableFooter><PLRow label={<span className="font-medium">{t('Company total')}</span>} tot={all} loading={loading} href={`/finance/reports?tab=pl&from=${from}&to=${to}`} /></TableFooter>
            </Table>
          )}
        </CardContent>
      </Card>
      <SimpleFormDialog<Values> open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={current ? t('Edit {name}', { name: current.name }) : t('New cost center')} schema={schema}
        defaultValues={current ? { code: current.code, name: current.name, parent_id: current.parent_id, is_active: current.is_active } : { code: '', name: '', parent_id: null, is_active: true }}
        fields={[
          { name: 'code', label: t('Code'), half: true, uppercase: true, placeholder: 'TIR' },
          { name: 'name', label: t('Name'), half: true, placeholder: t('Tirana store') },
          { name: 'parent_id', label: t('Belongs to'), type: 'select', optional: true, options: [{ value: '__none', label: t('Nothing (top level)') }, ...list.filter((c) => c.id !== current?.id).map((c) => ({ value: c.id, label: `${c.code} ${c.name}` }))] },
          { name: 'is_active', label: t('Active'), type: 'switch' },
        ]}
        submitLabel={t('Save')}
        onSubmit={async (v) => { await save.mutateAsync({ id: current?.id, ...v }); toast.success(t('Cost center saved')) }} />
    </>
  )
}

function PLRow({ label, parent, tot, loading, href, action }: { label: React.ReactNode; parent?: string; tot: ReturnType<typeof plTotals> | null | undefined; loading: boolean; href?: string; action?: React.ReactNode }) {
  const cell = (v: number | undefined) => loading ? <Skeleton className="ml-auto h-4 w-20" /> : <span className={cn('tabular', !v && 'text-muted-foreground/50')}>{v ? formatMoney(v) : '—'}</span>
  const margin = tot && tot.revenue ? (tot.profit / tot.revenue) * 100 : null
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell>{href ? <Link to={href} className="hover:underline">{label}</Link> : label}</TableCell>
      <TableCell className="text-[13px] text-muted-foreground">{parent ?? ''}</TableCell>
      <TableCell className="text-right">{cell(tot?.revenue)}</TableCell>
      <TableCell className="text-right">{cell(tot?.cogs)}</TableCell>
      <TableCell className="text-right">{cell(tot?.expenses)}</TableCell>
      <TableCell className={cn('text-right font-medium', num(tot?.profit) < 0 && 'text-destructive')}>{cell(tot?.profit)}</TableCell>
      <TableCell className="text-right text-[13px] text-muted-foreground tabular">{margin == null ? '—' : `${formatMoney(margin, undefined, 1)}%`}</TableCell>
      <TableCell>{action}</TableCell>
    </TableRow>
  )
}
