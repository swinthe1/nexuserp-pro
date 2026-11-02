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
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { msg, t, td } from '@/i18n'
import { cn, formatDate, formatMoney, formatQty } from '@/lib/utils'
import { useWarehouses } from '../api'
import { useAbcItems, useAbcRun, useAbcSettingsSave, useAbcSummary, useStockNotSold, type Abc, type AbcRow, type AbcSettings, type AbcSummary, type Xyz } from '../abc'

const ROWS: Abc[] = ['A', 'B', 'C']
const COLS: Xyz[] = ['X', 'Y', 'Z']
const XYZ_LABEL = { X: msg('Steady|xyz'), Y: msg('Changing|xyz'), Z: msg('Rare|xyz') } as const
/** what to do with the items of each XYZ box */
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
const TONE: Record<Abc, string> = { A: 'bg-primary/[0.12] border-primary/40', B: 'bg-sky-500/[0.07] border-sky-500/30', C: 'bg-muted border-border' }
const PERIODS = [30, 60, 90, 180, 365]
const pct = (v: number) => formatQty(Math.round(v * 10) / 10)

/** ABC: which items carry the business. XYZ (how regularly they sell) only when switched on in the rules. */
export function AbcPage() {
  const warehouses = useWarehouses()
  const units = (warehouses.data ?? []).filter((w) => w.is_active && w.warehouse_type !== 'transit')
  const [wh, setWh] = React.useState<string | null>(null)
  const [sel, setSel] = React.useState<string | null>(null)
  const [dead, setDead] = React.useState(false)
  const [days, setDays] = React.useState(90)
  const [since, setSince] = React.useState<string | null>(null)
  const [q, setQ] = React.useState('')
  const [more, setMore] = React.useState(false)
  const [rules, setRules] = React.useState(false)
  const sum = useAbcSummary(wh)
  const items = useAbcItems(wh)
  const notSold = useStockNotSold(wh, days, since)
  const run = useAbcRun()
  const s = sum.data
  const xyz = !!s?.settings.xyz
  const byQty = s?.settings.basis === 'qty'
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const match = (name: string, sku: string) => words.every((w) => `${name} ${sku}`.toLowerCase().includes(w))
  const rows = (items.data ?? []).filter((r) => (!sel || (sel.length === 1 ? r.abc === sel : r.abc + r.xyz === sel)) && match(r.variant?.name ?? '', r.variant?.sku ?? ''))
  const deadRows = (notSold.data?.rows ?? []).filter((r) => match(r.name, r.sku))
  const shown = more ? rows : rows.slice(0, 150)
  const pick = (k: string) => { setSel(sel === k ? null : k); setDead(false); setMore(false) }

  return (
    <>
      <PageHeader title={xyz ? t('ABC-XYZ classification') : t('ABC classification')}
        description={xyz
          ? t('Which items carry the business (A, B, C by the value that leaves the stock) and how regularly they sell (X, Y, Z). It decides how often each item is counted and how it is reordered.')
          : t('Which items carry the business: A, B and C by the value that leaves the stock. It decides how often each item is counted and how closely it is followed.')}
        actions={<>
          <Select value={wh ?? 'all'} onValueChange={(v) => { setWh(v === 'all' ? null : v); setSel(null) }}>
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
            {xyz ? <Matrix s={s} sel={sel} pick={pick} /> : <Classes s={s} sel={sel} pick={pick} rows={items.data ?? []} />}

            <div className="grid content-start gap-3">
              <Card><CardContent className="grid gap-3 p-4 text-[13px]">
                <div><div className="text-muted-foreground">{t('Items classified')}</div><div className="text-xl font-semibold tabular">{s.items}</div></div>
                <div><div className="text-muted-foreground">{t('Left the stock, at cost')}</div><div className="text-xl font-semibold tabular">{formatMoney(s.value)}</div></div>
                <div><div className="text-muted-foreground">{t('In stock now, at cost')}</div><div className="text-xl font-semibold tabular">{formatMoney(s.stock_value)}</div></div>
              </CardContent></Card>

              <div className={cn('grid gap-2 rounded-lg border border-warning/40 bg-warning/[0.06] p-4 text-[13px]', dead && 'ring-2 ring-warning')}>
                <span className="flex items-center gap-2 font-medium"><PackageX className="size-4 text-warning" /> {t('In stock, but not sold')}</span>
                <div className="flex flex-wrap gap-2">
                  <Select value={since ? 'date' : String(days)} onValueChange={(v) => { if (v === 'date') setSince(since ?? new Date(Date.now() - days * 864e5).toISOString().slice(0, 10)); else { setSince(null); setDays(Number(v)) } }}>
                    <SelectTrigger className="h-9 w-full bg-background" aria-label={t('Period')}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PERIODS.map((d) => <SelectItem key={d} value={String(d)}>{d === 365 ? t('In the last year') : t('In the last {n} days', { n: d })}</SelectItem>)}
                      <SelectItem value="date">{t('Since a date…')}</SelectItem>
                    </SelectContent>
                  </Select>
                  {since && <Input type="date" className="h-9 bg-background" value={since} max={new Date().toISOString().slice(0, 10)} onChange={(e) => e.target.value && setSince(e.target.value)} aria-label={t('Since')} />}
                </div>
                {notSold.isLoading ? <Skeleton className="h-7 w-32" /> : (
                  <button type="button" className="text-left text-xl font-semibold tabular hover:underline" onClick={() => { setDead(!dead); setSel(null); setMore(false) }}>
                    {t('{n} items · {value}', { n: notSold.data?.items ?? 0, value: formatMoney(notSold.data?.stock_value ?? 0) })}
                  </button>)}
                <span className="text-xs text-muted-foreground">{t('Not one sold since {date}: money standing on the shelf. Goods that came in after that date are left out.', { date: formatDate(notSold.data?.from ?? since ?? '') })}</span>
                <button type="button" className="justify-self-start text-primary hover:underline" onClick={() => { setDead(!dead); setSel(null); setMore(false) }}>{dead ? t('Show all items') : t('Show them')}</button>
              </div>

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
              <div><CardTitle>{dead ? t('In stock, but not sold') : sel ? t('Items in {cell}', { cell: sel }) : t('All items, the most valuable first')}</CardTitle>
                <CardDescription>{t('{n} items', { n: dead ? deadRows.length : rows.length })}{(sel || dead) && <button type="button" className="ml-2 text-primary hover:underline" onClick={() => { setSel(null); setDead(false) }}>{t('Show all')}</button>}</CardDescription></div>
              <div className="relative w-full sm:w-64"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" placeholder={t('Search items…')} aria-label={t('Search items…')} /></div>
            </CardHeader>
            <CardContent className="p-0">
              {dead ? (notSold.isLoading ? <Skeleton className="m-4 h-40" /> : (
                <Table>
                  <TableHeader><TableRow className="hover:bg-transparent">
                    <TableHead>{t('Item')}</TableHead><TableHead className="text-right">{t('In stock')}</TableHead><TableHead className="text-right">{t('Value at cost')}</TableHead>
                    <TableHead>{t('Last sold')}</TableHead><TableHead>{t('In stock since')}</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {deadRows.map((r) => (
                      <TableRow key={r.variant_id}>
                        <TableCell className="text-[13px]"><Link to={`/inventory/products/${r.product_id}`} className="font-medium hover:underline">{r.name}</Link><span className="ml-2 font-mono text-xs text-muted-foreground">{r.sku}</span></TableCell>
                        <TableCell className="text-right tabular">{formatQty(r.on_hand)}</TableCell>
                        <TableCell className="text-right tabular">{formatMoney(r.stock_value)}</TableCell>
                        <TableCell className="text-[13px]">{r.last_sold ? formatDate(r.last_sold) : <span className="text-warning">{t('Never')}</span>}</TableCell>
                        <TableCell className="text-[13px] text-muted-foreground">{r.first_in ? formatDate(r.first_in) : '—'}</TableCell>
                      </TableRow>))}
                    {!deadRows.length && <TableRow><TableCell colSpan={5} className="py-8 text-center text-[13px] text-muted-foreground">{t('Everything in stock has sold in this period.')}</TableCell></TableRow>}
                  </TableBody>
                </Table>
              )) : items.isLoading ? <Skeleton className="m-4 h-40" /> : (
                <Table>
                  <TableHeader><TableRow className="hover:bg-transparent">
                    <TableHead className="w-12 text-right">#</TableHead><TableHead>{t('Item')}</TableHead><TableHead>{t('Class')}</TableHead>
                    <TableHead className="text-right">{byQty ? t('Quantity out') : t('Value out')}</TableHead><TableHead className="text-right">{t('Share')}</TableHead>
                    <TableHead className="text-right">{t('Cumulative')}</TableHead><TableHead className="text-right">{t('Months with sales')}</TableHead>
                    {xyz && <TableHead className="text-right">{t('Weekly variation')}</TableHead>}<TableHead className="text-right">{t('In stock')}</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {shown.map((r) => (
                      <TableRow key={r.variant_id}>
                        <TableCell className="text-right tabular text-muted-foreground">{r.rank}</TableCell>
                        <TableCell className="text-[13px]"><Link to={`/inventory/products/${r.variant?.product_id}`} className="font-medium hover:underline">{r.variant?.name}</Link>
                          <span className="ml-2 font-mono text-xs text-muted-foreground">{r.variant?.sku}</span></TableCell>
                        <TableCell><Badge variant={r.abc === 'A' ? 'success' : r.abc === 'B' ? 'secondary' : 'outline'} className="font-mono">{r.abc}{xyz ? r.xyz : ''}</Badge></TableCell>
                        <TableCell className="text-right tabular">{byQty ? formatQty(r.qty) : formatMoney(r.value)}</TableCell>
                        <TableCell className="text-right tabular">{formatQty(Math.round(r.share * 100) / 100)} %</TableCell>
                        <TableCell className="text-right tabular text-muted-foreground">{pct(r.cum_share)} %</TableCell>
                        <TableCell className="text-right tabular">{r.months_sold}</TableCell>
                        {xyz && <TableCell className="text-right tabular">{r.cv == null ? '—' : `${formatQty(Math.round(r.cv * 100))} %`}</TableCell>}
                        <TableCell className="text-right tabular">{formatQty(r.on_hand)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {!dead && rows.length > shown.length && <div className="p-3"><Button variant="ghost" onClick={() => setMore(true)}>{t('Show all {n}', { n: rows.length })}</Button></div>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle>{t('How it works')}</CardTitle></CardHeader>
            <CardContent className={cn('grid gap-3 text-[13px] text-muted-foreground', xyz && 'md:grid-cols-2')}>
              <p>{t('ABC (Pareto): the items are put in order by the value that left the stock in the period, at cost; sales, the till and raw material used in production count, returns are taken off. The items that make the first {a} % of the value are A, up to {b} % B, the rest C. Usually few items are A.', { a: s.settings.a, b: s.settings.b })}</p>
              {xyz ? <p>{t('XYZ: how regularly the item leaves, week after week, since it first sold (the coefficient of variation of the weekly quantity). Up to {x} % it is X (steady), up to {y} % Y (changing), above that or without sales Z (rare). Every unit is classified on its own too.', {
                x: Math.round(s.settings.x * 100), y: Math.round(s.settings.y * 100) })}</p>
                : <p>{t('Every unit is classified on its own too. For how regularly items sell (XYZ), switch it on under Rules.')}</p>}
            </CardContent>
          </Card>
        </div>
      )}
      {rules && s && <RulesDialog initial={s.settings} onClose={() => setRules(false)} />}
    </>
  )
}

/** ABC alone: three classes, side by side */
function Classes({ s, sel, pick, rows }: { s: AbcSummary; sel: string | null; pick: (k: string) => void; rows: AbcRow[] }) {
  const of = (a: Abc) => {
    const cells = s.cells.filter((c) => c.abc === a)
    return { items: cells.reduce((t, c) => t + c.items, 0), share: cells.reduce((t, c) => t + c.share, 0), stock: cells.reduce((t, c) => t + c.stock_value, 0) }
  }
  const text: Record<Abc, string> = {
    A: t('The few items that make {p} % of the value. Never run out of them: follow them closely, count them every {d} days.', { p: s.settings.a, d: s.settings.count_a }),
    B: t('The middle items, the next {p} % of the value: normal care, count them every {d} days.', { p: s.settings.b - s.settings.a, d: s.settings.count_b }),
    C: t('Most of the items, little of the value: keep it simple, count them every {d} days.', { d: s.settings.count_c }),
  }
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle>{t('The three classes')}</CardTitle>
        <CardDescription>{t('Tap a class to see its items. The share is of the value that left the stock.')}</CardDescription></CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-3">
        {ROWS.map((a) => {
          const x = of(a)
          return (
            <button key={a} type="button" onClick={() => pick(a)}
              className={cn('grid content-start gap-2 rounded-xl border p-4 text-left transition-colors hover:border-primary', TONE[a], sel === a && 'ring-2 ring-primary')}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-4xl font-semibold leading-none">{a}</span>
                <span className="text-right"><span className="block text-2xl font-semibold tabular leading-none">{pct(x.share)} %</span><span className="text-xs text-muted-foreground">{t('of the value')}</span></span>
              </div>
              <div className="text-[13px] font-medium">{t('{n} items', { n: x.items })} · {t('{p} % of the items', { p: pct(s.items ? (x.items / s.items) * 100 : 0) })}</div>
              <div className="text-xs text-muted-foreground">{t('In stock {value}', { value: formatMoney(x.stock) })}</div>
              <p className="text-xs leading-snug text-muted-foreground">{text[a]}</p>
            </button>
          )
        })}
        <ParetoBars s={s} of={of} />
        <TopA rows={rows} />
        <AMissing rows={rows} />
      </CardContent>
    </Card>
  )
}

const BAR: Record<Abc, string> = { A: 'bg-primary', B: 'bg-sky-500', C: 'bg-muted-foreground/40' }
/** the Pareto picture: few items make most of the value */
function ParetoBars({ s, of }: { s: AbcSummary; of: (a: Abc) => { items: number; share: number } }) {
  const line = (label: string, part: (a: Abc) => number) => (
    <div className="grid gap-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex h-7 overflow-hidden rounded-md">
        {ROWS.map((a) => { const w = part(a); return w > 0 && (
          <div key={a} className={cn('flex items-center justify-center text-[11px] font-semibold text-white', BAR[a], a === 'C' && 'text-foreground')} style={{ width: `${w}%` }}>
            {w >= 7 ? `${a} ${pct(w)} %` : a}</div>) })}
      </div>
    </div>
  )
  return (
    <div className="grid gap-2.5 rounded-xl border bg-background p-4 md:col-span-3">
      <div className="text-[13px] font-medium">{t('Few items, most of the value')}</div>
      {line(t('Share of the items'), (a) => (s.items ? (of(a).items / s.items) * 100 : 0))}
      {line(t('Share of the value'), (a) => of(a).share)}
    </div>
  )
}

/** the most valuable items */
function TopA({ rows }: { rows: AbcRow[] }) {
  const top = rows.filter((r) => r.abc === 'A').slice(0, 6)
  if (!top.length) return null
  return (
    <div className="grid content-start gap-1.5 rounded-xl border bg-background p-4 md:col-span-2">
      <div className="text-[13px] font-medium">{t('The most valuable items')}</div>
      {top.map((r) => (
        <Link key={r.variant_id} to={`/inventory/products/${r.variant?.product_id}`} className="flex items-center gap-2 rounded-md px-1 py-1 text-[13px] hover:bg-muted">
          <span className="w-5 text-right tabular text-xs text-muted-foreground">{r.rank}</span>
          <span className="min-w-0 flex-1 truncate">{r.variant?.name}</span>
          <span className="w-28 overflow-hidden rounded-full bg-muted"><span className="block h-1.5 rounded-full bg-primary" style={{ width: `${Math.min(100, (r.share / (top[0]!.share || 1)) * 100)}%` }} /></span>
          <span className="w-14 text-right tabular text-xs">{formatQty(Math.round(r.share * 10) / 10)} %</span>
        </Link>))}
    </div>
  )
}

/** A items with nothing in stock: the ones that must never run out */
function AMissing({ rows }: { rows: AbcRow[] }) {
  const out = rows.filter((r) => r.abc === 'A' && r.on_hand <= 0)
  return (
    <div className={cn('grid content-start gap-1.5 rounded-xl border p-4', out.length ? 'border-destructive/40 bg-destructive/[0.04]' : 'border-success/40 bg-success/[0.05]')}>
      <div className="text-[13px] font-medium">{t('A items out of stock')}</div>
      {!out.length ? <p className="text-xs text-muted-foreground">{t('Every A item is in stock.')}</p> : <>
        {out.slice(0, 6).map((r) => (
          <Link key={r.variant_id} to={`/inventory/check?code=${encodeURIComponent(r.variant?.sku ?? '')}`} className="truncate text-[13px] text-destructive hover:underline">{r.variant?.name}</Link>))}
        {out.length > 6 && <span className="text-xs text-muted-foreground">{t('and {n} more', { n: out.length - 6 })}</span>}
        <span className="text-xs text-muted-foreground">{t('Tap one to see which unit has it.')}</span>
      </>}
    </div>
  )
}

/** ABC with XYZ: the 3 × 3 matrix */
function Matrix({ s, sel, pick }: { s: AbcSummary; sel: string | null; pick: (k: string) => void }) {
  const cellOf = (a: Abc, x: Xyz) => s.cells.find((c) => c.abc === a && c.xyz === x)
  const rowOf = (a: Abc) => s.cells.filter((c) => c.abc === a)
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle>{t('The matrix')}</CardTitle>
        <CardDescription>{t('Tap a box to see its items. The share is of the value that left the stock.')}</CardDescription></CardHeader>
      <CardContent className="overflow-x-auto">
        <div className="grid min-w-[560px] grid-cols-[110px_repeat(3,minmax(0,1fr))] gap-2">
          <div />
          {COLS.map((x) => <div key={x} className="px-1 text-[13px]"><span className="font-semibold">{x}</span> <span className="text-muted-foreground">{t(XYZ_LABEL[x])}</span></div>)}
          {ROWS.map((a) => (
            <React.Fragment key={a}>
              <button type="button" onClick={() => pick(a)} className={cn('grid content-center gap-0.5 rounded-lg pr-2 text-left hover:bg-muted', sel === a && 'ring-2 ring-primary')}>
                <span className="text-2xl font-semibold leading-none">{a}</span>
                <span className="text-xs text-muted-foreground">{t('{n} items · {p} %', { n: rowOf(a).reduce((t, c) => t + c.items, 0), p: pct(rowOf(a).reduce((t, c) => t + c.share, 0)) })}</span>
              </button>
              {COLS.map((x) => {
                const c = cellOf(a, x); const key = a + x
                return (
                  <button key={key} type="button" onClick={() => pick(key)}
                    className={cn('grid min-h-[112px] content-start gap-1 rounded-lg border p-2.5 text-left transition-colors hover:border-primary', TONE[a], sel === key && 'ring-2 ring-primary', !c && 'opacity-60')}>
                    <div className="flex items-baseline justify-between gap-2"><span className="font-mono text-[13px] font-semibold">{key}</span><span className="text-lg font-semibold tabular">{c?.items ?? 0}</span></div>
                    <span className="text-xs tabular text-muted-foreground">{t('{p} % of the value', { p: pct(c?.share ?? 0) })}</span>
                    <span className="text-[11px] leading-snug text-muted-foreground">{t(ADVICE[key]!)}</span>
                  </button>
                )
              })}
            </React.Fragment>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function RulesDialog({ initial, onClose }: { initial: AbcSettings; onClose: () => void }) {
  const save = useAbcSettingsSave()
  const [v, setV] = React.useState<AbcSettings>({ ...initial, xyz: !!initial.xyz })
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
          {num('count_a', t('Count A every … days'))}
          {num('count_b', t('Count B every … days'))}
          {num('count_c', t('Count C every … days'))}
          <div />
          <label className="flex items-start justify-between gap-3 rounded-md border p-3 text-[13px] sm:col-span-2">
            <span><span className="font-medium">{t('XYZ: how regularly items sell')}</span>
              <span className="block text-muted-foreground">{t('Optional. Splits each class by how steady the sales are week after week (X steady, Y changing, Z rare) and shows a 3 × 3 matrix.')}</span></span>
            <Switch checked={v.xyz} onCheckedChange={(c) => setV({ ...v, xyz: c })} />
          </label>
          {v.xyz && <>{num('x', t('X: weekly variation up to … %'), undefined, 100)}{num('y', t('Y: weekly variation up to … %'), undefined, 100)}</>}
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Can perm="inventory.write"><Button loading={save.isPending} onClick={async () => { try { await save.mutateAsync(v); onClose() } catch { /* toast */ } }}>{t('Save and classify')}</Button></Can></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
