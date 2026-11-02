import { Calculator, ClipboardCheck, PackageX, RefreshCw, Search, SlidersHorizontal } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { Can } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { msg, t, td } from '@/i18n'
import { cn, formatDate, formatMoney, formatQty } from '@/lib/utils'
import { useWarehouses } from '../api'
import { useAbcItems, useAbcRun, useAbcSettingsSave, useAbcSummary, type Abc, type AbcSettings, type Xyz } from '../abc'

const ROWS: Abc[] = ['A', 'B', 'C']
const COLS: Xyz[] = ['X', 'Y', 'Z']
const XYZ_LABEL = { X: msg('Steady|xyz'), Y: msg('Changing|xyz'), Z: msg('Rare|xyz') } as const
/** what to do with the items of each cell */
const ADVICE: Record<string, string> = {
  AX: msg('Sells a lot, every week: automatic reordering, little safety stock, count every month.'),
  AY: msg('A lot of value, but it changes: follow it closely and keep more safety stock.'),
  AZ: msg('A lot of value, hard to predict: order when it is asked for; do not keep much.'),
  BX: msg('Middle value, steady: automatic reordering.'),
  BY: msg('Middle value, it changes: look at the minimum every three months.'),
  BZ: msg('Middle value, rare: order when needed.'),
  CX: msg('Little value, steady: order seldom, in bigger amounts.'),
  CY: msg('Little value: keep it simple, one minimum and no more.'),
  CZ: msg('Little value and rare: candidates to stop selling.'),
}
const TONE: Record<Abc, string> = { A: 'bg-primary/[0.14] border-primary/40', B: 'bg-sky-500/[0.08] border-sky-500/30', C: 'bg-muted border-border' }

export function AbcPage() {
  const warehouses = useWarehouses()
  const units = (warehouses.data ?? []).filter((w) => w.is_active && w.warehouse_type !== 'transit')
  const [wh, setWh] = React.useState<string | null>(null)
  const [cell, setCell] = React.useState<string | null>(null)
  const [dead, setDead] = React.useState(false)
  const [q, setQ] = React.useState('')
  const [more, setMore] = React.useState(false)
  const [rules, setRules] = React.useState(false)
  const sum = useAbcSummary(wh)
  const items = useAbcItems(wh)
  const run = useAbcRun()
  const s = sum.data
  const cellOf = (a: Abc, x: Xyz) => s?.cells.find((c) => c.abc === a && c.xyz === x)
  const rowShare = (a: Abc) => (s?.cells ?? []).filter((c) => c.abc === a).reduce((t, c) => t + c.share, 0)
  const rowItems = (a: Abc) => (s?.cells ?? []).filter((c) => c.abc === a).reduce((t, c) => t + c.items, 0)
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const rows = (items.data ?? []).filter((r) => (!cell || r.abc + r.xyz === cell) && (!dead || (r.months_sold === 0 && r.on_hand > 0))
    && words.every((w) => `${r.variant?.name ?? ''} ${r.variant?.sku ?? ''}`.toLowerCase().includes(w)))
  const shown = more ? rows : rows.slice(0, 150)
  const byQty = s?.settings.basis === 'qty'

  return (
    <>
      <PageHeader title={t('ABC-XYZ classification')}
        description={t('Which items carry the business (A, B, C by the value that leaves the stock) and how regularly they sell (X, Y, Z). It decides how often each item is counted and how it is reordered.')}
        actions={<>
          <Select value={wh ?? 'all'} onValueChange={(v) => { setWh(v === 'all' ? null : v); setCell(null) }}>
            <SelectTrigger className="w-[220px]" aria-label={t('Unit')}><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">{t('The whole company')}</SelectItem>{units.map((w) => <SelectItem key={w.id} value={w.id}>{td(w.name)}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" onClick={() => setRules(true)}><SlidersHorizontal /> {t('Rules')}</Button>
          <Can perm="inventory.write"><Button variant="outline" loading={run.isPending} onClick={() => run.mutate()}><RefreshCw /> {t('Classify again')}</Button></Can>
        </>} />

      {sum.isError ? <ErrorState error={sum.error} onRetry={() => void sum.refetch()} /> : !s ? <Skeleton className="h-72" /> : !s.items ? (
        <EmptyState icon={Calculator} title={t('Nothing classified yet')} description={t('Items are classified from what leaves the stock: sales, the till and production. It happens every week by itself, or press "Classify again".')} />
      ) : (
        <div className="grid gap-4">
          <p className="text-[13px] text-muted-foreground">
            {t('Last {months} months · by {basis} · A up to {a} %, B up to {b} % · classified {date}', {
              months: s.settings.months, basis: byQty ? t('quantity') : t('value at cost'), a: s.settings.a, b: s.settings.b, date: s.computed_at ? formatDate(s.computed_at) : '—' })}
          </p>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
            <Card>
              <CardHeader className="pb-3"><CardTitle>{t('The matrix')}</CardTitle>
                <CardDescription>{t('Tap a box to see its items. The share is of the value that left the stock.')}</CardDescription></CardHeader>
              <CardContent className="overflow-x-auto">
                <div className="grid min-w-[560px] grid-cols-[110px_repeat(3,minmax(0,1fr))] gap-2">
                  <div />
                  {COLS.map((x) => (
                    <div key={x} className="px-1 text-[13px]"><span className="font-semibold">{x}</span> <span className="text-muted-foreground">{t(XYZ_LABEL[x])}</span></div>
                  ))}
                  {ROWS.map((a) => (
                    <React.Fragment key={a}>
                      <div className="grid content-center gap-0.5 pr-2">
                        <span className="text-2xl font-semibold leading-none">{a}</span>
                        <span className="text-xs text-muted-foreground">{t('{n} items · {p} %', { n: rowItems(a), p: formatQty(Math.round(rowShare(a) * 10) / 10) })}</span>
                      </div>
                      {COLS.map((x) => {
                        const c = cellOf(a, x); const key = a + x
                        return (
                          <button key={key} type="button" onClick={() => { setCell(cell === key ? null : key); setDead(false) }}
                            className={cn('grid min-h-[112px] content-start gap-1 rounded-lg border p-2.5 text-left transition-colors hover:border-primary', TONE[a],
                              cell === key && 'ring-2 ring-primary', !c && 'opacity-60')}>
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="font-mono text-[13px] font-semibold">{key}</span>
                              <span className="text-lg font-semibold tabular">{c?.items ?? 0}</span>
                            </div>
                            <span className="text-xs tabular text-muted-foreground">{t('{p} % of the value', { p: formatQty(Math.round((c?.share ?? 0) * 10) / 10) })}</span>
                            <span className="text-[11px] leading-snug text-muted-foreground">{t(ADVICE[key]!)}</span>
                          </button>
                        )
                      })}
                    </React.Fragment>
                  ))}
                </div>
              </CardContent>
            </Card>

            <div className="grid content-start gap-3">
              <Card><CardContent className="grid gap-3 p-4 text-[13px]">
                <div><div className="text-muted-foreground">{t('Items classified')}</div><div className="text-xl font-semibold tabular">{s.items}</div></div>
                <div><div className="text-muted-foreground">{t('Left the stock, at cost')}</div><div className="text-xl font-semibold tabular">{formatMoney(s.value)}</div></div>
                <div><div className="text-muted-foreground">{t('In stock now, at cost')}</div><div className="text-xl font-semibold tabular">{formatMoney(s.stock_value)}</div></div>
              </CardContent></Card>
              <button type="button" onClick={() => { setDead(!dead); setCell(null) }}
                className={cn('grid gap-1 rounded-lg border border-warning/40 bg-warning/[0.06] p-4 text-left text-[13px] hover:border-warning', dead && 'ring-2 ring-warning')}>
                <span className="flex items-center gap-2 font-medium"><PackageX className="size-4 text-warning" /> {t('In stock, but not sold')}</span>
                <span className="text-xl font-semibold tabular">{s.dead.items} · {formatMoney(s.dead.stock_value)}</span>
                <span className="text-xs text-muted-foreground">{t('Nothing left the stock in {months} months: money standing on the shelf.', { months: s.settings.months })}</span>
              </button>
              <Card><CardContent className="grid gap-2 p-4 text-[13px]">
                <div className="flex items-center gap-2 font-medium"><ClipboardCheck className="size-4 text-primary" /> {t('Counting by class')}</div>
                <p className="text-muted-foreground">{t('A every {a} days, B every {b} days, C every {c} days. The stock count page says what is due and makes the count.', {
                  a: s.settings.count_a, b: s.settings.count_b, c: s.settings.count_c })}</p>
                <Link to="/wms/counts" className="text-primary hover:underline">{t('Open stock counts')}</Link>
              </CardContent></Card>
            </div>
          </div>

          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0 pb-3">
              <div><CardTitle>{cell ? t('Items in {cell}', { cell }) : dead ? t('In stock, but not sold') : t('All items, the most valuable first')}</CardTitle>
                <CardDescription>{t('{n} items', { n: rows.length })}{(cell || dead) && <button type="button" className="ml-2 text-primary hover:underline" onClick={() => { setCell(null); setDead(false) }}>{t('Show all')}</button>}</CardDescription></div>
              <div className="relative w-full sm:w-64"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" placeholder={t('Search items…')} aria-label={t('Search items…')} /></div>
            </CardHeader>
            <CardContent className="p-0">
              {items.isLoading ? <Skeleton className="m-4 h-40" /> : (
                <Table>
                  <TableHeader><TableRow className="hover:bg-transparent">
                    <TableHead className="w-12 text-right">#</TableHead><TableHead>{t('Item')}</TableHead><TableHead>{t('Class')}</TableHead>
                    <TableHead className="text-right">{byQty ? t('Quantity out') : t('Value out')}</TableHead><TableHead className="text-right">{t('Share')}</TableHead>
                    <TableHead className="text-right">{t('Cumulative')}</TableHead><TableHead className="text-right">{t('Months with sales')}</TableHead>
                    <TableHead className="text-right">{t('Weekly variation')}</TableHead><TableHead className="text-right">{t('In stock')}</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {shown.map((r) => (
                      <TableRow key={r.variant_id}>
                        <TableCell className="text-right tabular text-muted-foreground">{r.rank}</TableCell>
                        <TableCell className="text-[13px]"><Link to={`/inventory/products/${r.variant?.product_id}`} className="font-medium hover:underline">{r.variant?.name}</Link>
                          <span className="ml-2 font-mono text-xs text-muted-foreground">{r.variant?.sku}</span></TableCell>
                        <TableCell><Badge variant={r.abc === 'A' ? 'success' : r.abc === 'B' ? 'secondary' : 'outline'} className="font-mono">{r.abc}{r.xyz}</Badge></TableCell>
                        <TableCell className="text-right tabular">{byQty ? formatQty(r.qty) : formatMoney(r.value)}</TableCell>
                        <TableCell className="text-right tabular">{formatQty(Math.round(r.share * 100) / 100)} %</TableCell>
                        <TableCell className="text-right tabular text-muted-foreground">{formatQty(Math.round(r.cum_share * 10) / 10)} %</TableCell>
                        <TableCell className="text-right tabular">{r.months_sold}</TableCell>
                        <TableCell className="text-right tabular">{r.cv == null ? '—' : `${formatQty(Math.round(r.cv * 100))} %`}</TableCell>
                        <TableCell className="text-right tabular">{formatQty(r.on_hand)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {rows.length > shown.length && <div className="p-3"><Button variant="ghost" onClick={() => setMore(true)}>{t('Show all {n}', { n: rows.length })}</Button></div>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle>{t('How it works')}</CardTitle></CardHeader>
            <CardContent className="grid gap-3 text-[13px] text-muted-foreground md:grid-cols-2">
              <p>{t('ABC (Pareto): the items are put in order by the value that left the stock in the period, at cost; sales, the till and raw material used in production count, returns are taken off. The items that make the first {a} % of the value are A, up to {b} % B, the rest C. Usually few items are A.', { a: s.settings.a, b: s.settings.b })}</p>
              <p>{t('XYZ: how regularly the item leaves, week after week, since it first sold (the coefficient of variation of the weekly quantity). Up to {x} % it is X (steady), up to {y} % Y (changing), above that or without sales Z (rare). Every unit is classified on its own too.', {
                x: Math.round(s.settings.x * 100), y: Math.round(s.settings.y * 100) })}</p>
            </CardContent>
          </Card>
        </div>
      )}
      {rules && s && <RulesDialog initial={s.settings} onClose={() => setRules(false)} />}
    </>
  )
}

function RulesDialog({ initial, onClose }: { initial: AbcSettings; onClose: () => void }) {
  const save = useAbcSettingsSave()
  const [v, setV] = React.useState<AbcSettings>(initial)
  const num = (k: keyof AbcSettings, label: string, hint?: string, scale = 1) => (
    <div className="grid gap-1">
      <Label htmlFor={`abc-${k}`}>{label}</Label>
      <Input id={`abc-${k}`} inputMode="decimal" value={String(Math.round(Number(v[k]) * scale * 100) / 100)}
        onChange={(e) => setV({ ...v, [k]: Number(e.target.value.replace(',', '.')) / scale })} />
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  )
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{t('Classification rules')}</DialogTitle>
          <DialogDescription>{t('Saving classifies every item again with the new rules.')}</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1 sm:col-span-2"><Label>{t('Classify by')}</Label>
            <Select value={v.basis} onValueChange={(b) => setV({ ...v, basis: b as AbcSettings['basis'] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="value">{t('Value that left the stock, at cost (recommended)')}</SelectItem><SelectItem value="qty">{t('Quantity that left the stock')}</SelectItem></SelectContent>
            </Select></div>
          {num('months', t('Months looked at'), t('3 to 24'))}
          <div />
          {num('a', t('A: the first … % of the value'))}
          {num('b', t('B: up to … % of the value'))}
          {num('x', t('X: weekly variation up to … %'), undefined, 100)}
          {num('y', t('Y: weekly variation up to … %'), undefined, 100)}
          {num('count_a', t('Count A every … days'))}
          {num('count_b', t('Count B every … days'))}
          {num('count_c', t('Count C every … days'))}
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Can perm="inventory.write"><Button loading={save.isPending} onClick={async () => { try { await save.mutateAsync(v); onClose() } catch { /* toast */ } }}>{t('Save and classify')}</Button></Can></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
