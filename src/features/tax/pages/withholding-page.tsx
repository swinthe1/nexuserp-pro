import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Landmark, Plus } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { ExportMenu } from '@/components/export-menu'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { t, td } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import type { XlsxColumn } from '@/lib/export'
import { supabase } from '@/lib/supabase'
import { formatDate, formatMoney, num } from '@/lib/utils'
import { useWithholdingCodes } from '@/features/procurement/components/withholding-card'
import { monthLabel, monthRange, previousMonth, useCompanyTaxProfile } from '../api'

type Row = { id: string; date: string; bill_id: string; bill: string; their_number: string | null; vendor: string; tax_number: string | null; code: string; kind: string; base: number; rate: number; amount: number }
type Report = { from: string; to: string; due: string; rows: Row[]; totals: { code: string; kind: string; rate: number; count: number; base: number; amount: number }[] }

/** Tax › Withholding tax: what was withheld in a month, for the monthly declaration, and the kinds with their rates. */
export function WithholdingPage() {
  return (
    <>
      <PageHeader title={t('Withholding tax')} description={t('Tax withheld from payments for rent, interest, royalties and services of individuals or non-residents. It is withheld on the supplier\'s bill and declared and paid every month.')} />
      <Tabs defaultValue="month">
        <TabsList><TabsTrigger value="month">{t('By month')}</TabsTrigger><TabsTrigger value="kinds">{t('Kinds and rates')}</TabsTrigger></TabsList>
        <TabsContent value="month"><MonthTab /></TabsContent>
        <TabsContent value="kinds"><KindsTab /></TabsContent>
      </Tabs>
    </>
  )
}

function MonthTab() {
  const { companyId, company } = useCompany()
  const profile = useCompanyTaxProfile()
  const [ym, setYm] = React.useState(previousMonth())
  const { from, to } = monthRange(ym)
  const q = useQuery({ queryKey: ['wht', companyId, ym], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('withholding_report', { p_company: companyId!, p_from: from, p_to: to })) as unknown as Report })
  const r = q.data
  const cur = company?.base_currency
  const cols: XlsxColumn<Row>[] = [
    { header: t('Date'), value: (x) => x.date, format: 'date' }, { header: t('Supplier'), value: (x) => x.vendor },
    { header: t('Tax number'), value: (x) => x.tax_number ?? '', format: 'text' }, { header: t('Bill'), value: (x) => x.bill },
    { header: t('Their number'), value: (x) => x.their_number ?? '' }, { header: t('Kind|withholding'), value: (x) => td(x.kind) },
    { header: t('Paid on'), value: (x) => x.base, format: 'money' }, { header: t('Rate %'), value: (x) => x.rate, format: 'qty' },
    { header: t('Tax withheld'), value: (x) => x.amount, format: 'money' },
  ]
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5"><Label htmlFor="wh-month">{t('Month')}</Label>
          <Input id="wh-month" type="month" className="w-44" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} /></div>
        {r && <p className="pb-2 text-[13px] text-muted-foreground">{t('Declare and pay by {date}.', { date: formatDate(r.due) })}</p>}
        <div className="ml-auto">
          <ExportMenu rows={r?.rows ?? []} columns={cols} filename={`${t('withholding')}-${ym}`} title={`${t('Withholding tax')} · ${monthLabel(ym)}`} disabled={!r?.rows.length}
            xlsx={{ title: [profile.data?.legal_name ?? profile.data?.name ?? '', `${t('Tax number')} ${profile.data?.tax_number ?? '—'}`, `${t('Withholding tax')} · ${monthLabel(ym)}`],
              totals: { [t('Date')]: t('Total'), [t('Tax withheld')]: r?.rows.reduce((s, x) => s + num(x.amount), 0) ?? 0 } }} />
        </div>
      </div>
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !r ? <Skeleton className="h-48" /> : r.rows.length === 0 ? (
        <EmptyState icon={Landmark} title={t('Nothing withheld in {month}', { month: monthLabel(ym) })}
          description={t('Tax is withheld on a posted supplier\'s bill: open the bill and use “Withhold tax”.')} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {r.totals.map((x) => (
              <div key={x.code} className="rounded-lg border bg-card p-3">
                <p className="text-[13px] text-muted-foreground">{td(x.kind)} · {num(x.rate)} %</p>
                <p className="text-lg font-semibold tabular-nums">{formatMoney(x.amount, cur)}</p>
                <p className="text-xs text-muted-foreground">{t('{n} payments, on {amount}', { n: x.count, amount: formatMoney(x.base) })}</p>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <Table>
              <TableHeader><TableRow>
                <TableHead>{t('Date')}</TableHead><TableHead>{t('Supplier')}</TableHead><TableHead>{t('Bill')}</TableHead><TableHead>{t('Kind|withholding')}</TableHead>
                <TableHead className="text-right">{t('Paid on')}</TableHead><TableHead className="text-right">{t('Rate %')}</TableHead><TableHead className="text-right">{t('Tax withheld')}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {r.rows.map((x) => (
                  <TableRow key={x.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(x.date)}</TableCell>
                    <TableCell><div className="font-medium">{x.vendor}</div><div className="text-xs text-muted-foreground">{x.tax_number}</div></TableCell>
                    <TableCell className="whitespace-nowrap"><Link className="text-primary hover:underline" to={`/procurement/bills/${x.bill_id}`}>{x.bill}</Link>
                      {x.their_number && <div className="text-xs text-muted-foreground">{x.their_number}</div>}</TableCell>
                    <TableCell>{td(x.kind)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(x.base)}</TableCell>
                    <TableCell className="text-right tabular-nums">{num(x.rate)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatMoney(x.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter><TableRow><TableCell colSpan={6}>{t('Total')}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(r.rows.reduce((s, x) => s + num(x.amount), 0), cur)}</TableCell></TableRow></TableFooter>
            </Table>
          </div>
        </>
      )}
    </div>
  )
}

function KindsTab() {
  const { companyId, can } = useCompany()
  const qc = useQueryClient()
  const codes = useWithholdingCodes()
  const editable = can('tax.write')
  const [nw, setNw] = React.useState({ code: '', name: '', rate: '' })
  const upd = useMutation({
    mutationFn: async (a: { id: string; patch: { rate?: number; is_active?: boolean; name?: string } }) => unwrap(await supabase.from('withholding_codes').update(a.patch).eq('id', a.id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wht-codes'] }), onError: (e) => toast.error(describeError(e)),
  })
  const add = useMutation({
    mutationFn: async () => unwrap(await supabase.from('withholding_codes').insert({ company_id: companyId!, code: nw.code.trim().toUpperCase(), name: nw.name.trim(), rate: num(nw.rate), sort: 50 })),
    onSuccess: () => { setNw({ code: '', name: '', rate: '' }); void qc.invalidateQueries({ queryKey: ['wht-codes'] }) }, onError: (e) => toast.error(describeError(e)),
  })
  return (
    <div className="grid max-w-3xl gap-3">
      <p className="text-[13px] text-muted-foreground">{t('The usual rates of the country are filled in. Rates change with the law: check them with your accountant, and change them here when needed.')}</p>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader><TableRow><TableHead className="w-24">{t('Code')}</TableHead><TableHead>{t('Kind|withholding')}</TableHead><TableHead className="w-28 text-right">{t('Rate %')}</TableHead><TableHead className="w-24">{t('In use')}</TableHead></TableRow></TableHeader>
          <TableBody>
            {(codes.data ?? []).map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.code}</TableCell>
                <TableCell>{td(c.name)}</TableCell>
                <TableCell><Input type="number" step="0.1" min="0" max="100" className="h-8 text-right" defaultValue={num(c.rate)} disabled={!editable} aria-label={t('Rate of {name}', { name: td(c.name) })}
                  onBlur={(e) => { const v = num(e.target.value); if (v !== num(c.rate)) upd.mutate({ id: c.id, patch: { rate: v } }) }} /></TableCell>
                <TableCell><Switch checked={c.is_active} disabled={!editable} onCheckedChange={(on) => upd.mutate({ id: c.id, patch: { is_active: on } })} aria-label={t('{name} in use', { name: td(c.name) })} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {editable && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (nw.code.trim() && nw.name.trim() && nw.rate) add.mutate() }}>
          <div className="grid gap-1.5"><Label htmlFor="wk-code">{t('Code')}</Label><Input id="wk-code" className="w-24" maxLength={10} value={nw.code} onChange={(e) => setNw({ ...nw, code: e.target.value })} /></div>
          <div className="grid flex-1 gap-1.5"><Label htmlFor="wk-name">{t('Kind|withholding')}</Label><Input id="wk-name" className="min-w-48" value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value })} /></div>
          <div className="grid gap-1.5"><Label htmlFor="wk-rate">{t('Rate %')}</Label><Input id="wk-rate" type="number" step="0.1" className="w-24 text-right" value={nw.rate} onChange={(e) => setNw({ ...nw, rate: e.target.value })} /></div>
          <Button type="submit" variant="outline" loading={add.isPending}><Plus /> {t('Add')}</Button>
        </form>
      )}
    </div>
  )
}
