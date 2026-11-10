import * as React from 'react'
import { formatDateWith, formatNumberWith, t } from '@/i18n'
import { cn, formatMoney, formatMoneyCompact } from '@/lib/utils'

/*
 * The charts of the overview pages, drawn by hand so each can say more than a plain bar chart:
 * the same month last year, where the month is heading, the margin under the sales, a calendar of the days,
 * the busy hours, the categories with their margin and the way from the sales to the profit.
 * One scale per chart (never two), thin marks, a tooltip on hover, colours that colour-blind readers tell apart.
 */

export const C = {
  one: 'hsl(var(--primary))',
  two: 'hsl(var(--chart-2))',
  cost: 'hsl(var(--chart-3))',
  ink: 'hsl(var(--foreground))',
  muted: 'hsl(var(--muted-foreground))',
  grid: 'hsl(var(--border))',
  card: 'hsl(var(--card))',
}
const pct1 = (v: number) => formatNumberWith(v, { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** the width the chart has, following the card as the window changes */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = React.useRef<T>(null)
  const [w, setW] = React.useState(0)
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth)
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

/** a round top for the axis: 0, then steps of 1, 2 or 5 × 10ⁿ, about four of them */
export function niceScale(max: number, steps = 4) {
  if (!(max > 0)) return { top: 1, ticks: [0, 1] }
  const raw = max / steps, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p
  const top = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(v)
  return { top, ticks }
}

function Tip({ left, top, children }: { left: number; top: number; children: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute z-10 grid w-52 gap-1 rounded-lg border bg-popover px-3 py-2.5 text-xs text-popover-foreground shadow-lg" style={{ left, top }}>
      {children}
    </div>
  )
}
function TipRow({ color, label, value, strong, line }: { color?: string; label: string; value: string; strong?: boolean; line?: boolean }) {
  return (
    <div className={cn('flex items-center justify-between gap-2', strong && 'font-semibold', line && 'mt-0.5 border-t pt-1.5')}>
      <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">{color && <span className="size-2 shrink-0 rounded-sm" style={{ background: color }} />}<span className={cn('truncate', strong && 'text-foreground')}>{label}</span></span>
      <span className="tabular shrink-0">{value}</span>
    </div>
  )
}
export function ChangeChip({ pct, upIsGood = true, label }: { pct: number | null; upIsGood?: boolean; label?: string }) {
  if (pct == null || !isFinite(pct)) return null
  const good = (pct >= 0) === upIsGood
  return (
    <span className={cn('inline-flex w-fit items-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular', good ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive')}>
      {pct >= 0 ? '▲' : '▼'} {pct1(Math.abs(pct))}%{label ? ` ${label}` : ''}
    </span>
  )
}

export function Legend({ items }: { items: { label: string; color: string; kind?: 'box' | 'line' | 'dash' | 'hatch' }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          {i.kind === 'line' ? <span className="h-0.5 w-4 rounded" style={{ background: i.color }} />
            : i.kind === 'dash' ? <span className="w-4 border-t-2 border-dashed" style={{ borderColor: i.color }} />
            : i.kind === 'hatch' ? <span className="size-3 rounded-[3px] border border-dashed" style={{ borderColor: i.color, background: `repeating-linear-gradient(135deg, ${i.color} 0 1.5px, transparent 1.5px 5px)`, opacity: 0.8 }} />
            : <span className="size-3 rounded-[3px]" style={{ background: i.color }} />}
          {i.label}
        </span>
      ))}
    </div>
  )
}

const L = 64, R = 8

/* ------------------------------------------------------------------ A: the months, in bars */

export type MonthPart = { key: string; label: string; color: string }
export type MonthRow = {
  key: string; label: string; title: string
  values: Record<string, number>
  /** the same month a year before */
  ly?: number | null
  /** the month still running: where it ends at this pace */
  projected?: number | null
  /** gross margin %, when the person may see what the goods cost */
  margin?: number | null
}

export function MonthBars({ parts, rows, height = 260, currency, lyLabel = t('Same month last year'), marginTitle }: {
  parts: MonthPart[]; rows: MonthRow[]; height?: number; currency?: string | null; lyLabel?: string; marginTitle?: string
}) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [hv, setHv] = React.useState<number | null>(null)
  const totals = rows.map((r) => parts.reduce((s, p) => s + (r.values[p.key] ?? 0), 0))
  const { top, ticks } = niceScale(Math.max(1, ...totals, ...rows.map((r) => r.ly ?? 0), ...rows.map((r) => r.projected ?? 0)))
  const T = 22, B = 26, PH = height - T - B
  const plotW = Math.max(0, w - L - R), slot = rows.length ? plotW / rows.length : 0, bw = Math.max(6, Math.min(34, slot * 0.5))
  const y = (v: number) => T + PH * (1 - v / top)
  const x = (i: number) => L + i * slot + (slot - bw) / 2
  const peak = totals.reduce((b, v, i) => (v > totals[b]! ? i : b), 0)
  const hasLy = rows.some((r) => r.ly != null && r.ly > 0)
  const margins = rows.map((r) => r.margin ?? null)
  const hasMargin = margins.some((m) => m != null && isFinite(m))
  const legend = [
    ...(parts.length > 1 ? parts.map((p) => ({ label: p.label, color: p.color })) : []),
    ...(hasLy ? [{ label: lyLabel, color: C.ink, kind: 'line' as const }] : []),
    ...(rows.some((r) => r.projected) ? [{ label: t('Where the month ends at this pace'), color: parts[0]!.color, kind: 'hatch' as const }] : []),
  ]
  const cur = hv != null ? rows[hv] : null
  const curTotal = hv != null ? totals[hv]! : 0
  const chg = cur?.ly ? (curTotal / cur.ly - 1) * 100 : null
  return (
    <div className="grid gap-3">
      {legend.length > 0 && <Legend items={legend} />}
      <div ref={ref} className="relative select-none" style={{ height }} onMouseLeave={() => setHv(null)}>
        {w > 0 && <>
          {ticks.map((v) => (
            <React.Fragment key={v}>
              <div className="absolute h-px" style={{ left: L, right: R, top: y(v), background: C.grid, opacity: v === 0 ? 1 : 0.6 }} />
              <div className="absolute w-14 text-right text-[11px] text-muted-foreground" style={{ left: 0, top: y(v) - 8 }}>{v === 0 ? '0' : formatMoneyCompact(v, currency)}</div>
            </React.Fragment>
          ))}
          {rows.map((r, i) => {
            let base = 0
            return (
              <React.Fragment key={r.key}>
                <div className={cn('absolute rounded-md', hv === i && 'bg-foreground/[0.05]')} style={{ left: L + i * slot, width: slot, top: T, height: PH }} onMouseEnter={() => setHv(i)} />
                {parts.map((p, k) => {
                  const v = r.values[p.key] ?? 0
                  if (v <= 0) return null
                  const isTop = parts.slice(k + 1).every((q) => (r.values[q.key] ?? 0) <= 0)
                  const t0 = y(base + v), h = y(base) - y(base + v) - (base > 0 ? 2 : 0)
                  base += v
                  return <div key={p.key} className="pointer-events-none absolute" style={{ left: x(i), width: bw, top: t0, height: Math.max(1, h), background: p.color, borderRadius: isTop ? '4px 4px 0 0' : 0 }} />
                })}
                {r.projected != null && r.projected > totals[i]! && (
                  <div className="pointer-events-none absolute rounded-t border border-b-0 border-dashed" style={{ left: x(i), width: bw, top: y(r.projected), height: Math.max(0, y(totals[i]!) - y(r.projected) - 2), borderColor: parts[0]!.color,
                    background: `repeating-linear-gradient(135deg, color-mix(in srgb, ${parts[0]!.color} 35%, transparent) 0 2px, transparent 2px 6px)` }} />
                )}
                {r.ly != null && r.ly > 0 && <div className="pointer-events-none absolute h-0.5 rounded-full" style={{ left: x(i) - 5, width: bw + 10, top: y(r.ly) - 1, background: C.ink, opacity: 0.7 }} />}
                <div className={cn('pointer-events-none absolute text-center text-[11px]', hv === i ? 'font-bold text-foreground' : 'text-muted-foreground')} style={{ left: L + i * slot, width: slot, top: T + PH + 7 }}>{r.label}</div>
              </React.Fragment>
            )
          })}
          {totals[peak]! > 0 && slot > 30 && (
            <div className="pointer-events-none absolute text-center text-xs font-bold" style={{ left: L + peak * slot + slot / 2 - 50, width: 100, top: y(Math.max(totals[peak]!, rows[peak]!.ly ?? 0, rows[peak]!.projected ?? 0)) - 19 }}>{formatMoneyCompact(totals[peak]!, currency)}</div>
          )}
          {cur && (
            <Tip left={Math.min(Math.max(0, x(hv!) + (hv! > rows.length / 2 ? -216 : bw + 12)), w - 208)} top={Math.max(0, Math.min(y(curTotal) - 24, height - 150))}>
              <div className="text-[12.5px] font-bold">{cur.title}</div>
              {parts.length > 1 && parts.map((p) => <TipRow key={p.key} color={p.color} label={p.label} value={formatMoney(cur.values[p.key] ?? 0, currency)} />)}
              <TipRow strong line={parts.length > 1} label={parts.length > 1 ? t('Total') : parts[0]!.label} value={formatMoney(curTotal, currency)} />
              {cur.projected != null && <TipRow label={t('At this pace')} value={formatMoney(cur.projected, currency)} />}
              {cur.ly != null && cur.ly > 0 && <TipRow label={lyLabel} value={formatMoney(cur.ly, currency)} />}
              {cur.margin != null && <TipRow label={t('Gross margin')} value={`${pct1(cur.margin)}%`} />}
              {cur.projected == null && <ChangeChip pct={chg} label={t('vs last year')} />}
            </Tip>
          )}
        </>}
      </div>
      {hasMargin && w > 0 && <MarginStrip margins={margins} labels={rows.map((r) => r.label)} width={w} hv={hv} title={marginTitle ?? t('Gross margin')} />}
    </div>
  )
}

function MarginStrip({ margins, labels, width, hv, title }: { margins: (number | null)[]; labels: string[]; width: number; hv: number | null; title: string }) {
  const vals = margins.filter((m): m is number => m != null && isFinite(m))
  const lo = Math.floor(Math.min(...vals) - 1), hi = Math.ceil(Math.max(...vals) + 1)
  const H = 96, T = 10, PH = 70
  const slot = (width - L - R) / margins.length
  const y = (v: number) => T + PH * (1 - (v - lo) / (hi - lo || 1))
  const cx = (i: number) => L + i * slot + slot / 2
  let d = ''
  margins.forEach((m, i) => { if (m == null || !isFinite(m)) return; d += `${d ? 'L' : 'M'}${cx(i).toFixed(1)} ${y(m).toFixed(1)} ` })
  const lastI = margins.reduce<number>((b, m, i) => (m != null && isFinite(m) ? i : b), -1)
  const ticks = [lo, Math.round((lo + hi) / 2), hi]
  return (
    <div className="grid gap-1 border-t pt-3">
      <div className="flex items-baseline justify-between gap-2"><span className="text-[13px] font-semibold">{title}</span><span className="text-xs text-muted-foreground">{t('gross profit ÷ sales without VAT, the same months')}</span></div>
      <div className="relative" style={{ height: H }}>
        {ticks.map((v) => (
          <React.Fragment key={v}>
            <div className="absolute h-px" style={{ left: L, right: R, top: y(v), background: C.grid, opacity: 0.6 }} />
            <div className="absolute w-14 text-right text-[11px] text-muted-foreground" style={{ left: 0, top: y(v) - 8 }}>{v}%</div>
          </React.Fragment>
        ))}
        <svg width={width} height={H} className="absolute inset-0 overflow-visible" aria-hidden><path d={d} fill="none" stroke={C.one} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" /></svg>
        {margins.map((m, i) => m != null && isFinite(m) && (
          <div key={i} className="absolute rounded-full" style={{ left: cx(i) - (hv === i ? 5 : 4), top: y(m) - (hv === i ? 5 : 4), width: hv === i ? 10 : 8, height: hv === i ? 10 : 8, background: C.one, boxShadow: `0 0 0 2px ${C.card}` }} />
        ))}
        {lastI >= 0 && <div className="absolute w-16 text-center text-xs font-bold" style={{ left: cx(lastI) - 32, top: y(margins[lastI]!) - 22 }}>{pct1(margins[lastI]!)}%</div>}
        {hv != null && margins[hv] != null && hv !== lastI && <div className="absolute w-16 text-center text-xs font-bold" style={{ left: cx(hv) - 32, top: y(margins[hv]!) - 22 }}>{pct1(margins[hv]!)}%</div>}
      </div>
      <span className="sr-only">{labels.map((l, i) => `${l}: ${margins[i] != null ? pct1(margins[i]!) + '%' : '—'}`).join(', ')}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ B: this year against last year, as lines */

export function TrendLines({ rows, currency, height = 300, aLabel, bLabel }: {
  rows: { key: string; label: string; title: string; a: number | null; b: number | null; projected?: number | null }[]
  currency?: string | null; height?: number; aLabel: string; bLabel: string
}) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [hv, setHv] = React.useState<number | null>(null)
  const all = rows.flatMap((r) => [r.a ?? 0, r.b ?? 0, r.projected ?? 0])
  const { top, ticks } = niceScale(Math.max(1, ...all))
  const T = 14, B = 26, PH = height - T - B
  const slot = rows.length ? (w - L - 44) / rows.length : 0
  const cx = (i: number) => L + i * slot + slot / 2
  const y = (v: number) => T + PH * (1 - v / top)
  const path = (vals: (number | null)[]) => { let d = ''; vals.forEach((v, i) => { if (v == null) return; d += `${d ? 'L' : 'M'}${cx(i).toFixed(1)} ${y(v).toFixed(1)} ` }); return d }
  const aVals = rows.map((r) => (r.projected != null ? null : r.a))
  const lastA = aVals.reduce<number>((b, v, i) => (v != null ? i : b), -1)
  const line = path(aVals)
  const area = lastA >= 0 ? `${line}L${cx(lastA).toFixed(1)} ${y(0)} L${cx(aVals.findIndex((v) => v != null)).toFixed(1)} ${y(0)} Z` : ''
  const projI = rows.findIndex((r) => r.projected != null)
  const proj = projI > 0 && aVals[projI - 1] != null ? `M${cx(projI - 1).toFixed(1)} ${y(aVals[projI - 1]!).toFixed(1)} L${cx(projI).toFixed(1)} ${y(rows[projI]!.projected!).toFixed(1)}` : ''
  const done = rows.filter((r) => r.projected == null && r.a != null)
  const sumA = done.reduce((s, r) => s + (r.a ?? 0), 0), sumB = done.reduce((s, r) => s + (r.b ?? 0), 0)
  const best = done.reduce<typeof done[number] | null>((b, r) => (!b || (r.a ?? 0) > (b.a ?? 0) ? r : b), null)
  const cur = hv != null ? rows[hv]! : null
  const curA = cur ? cur.projected ?? cur.a : null
  return (
    <div className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="grid gap-0.5 rounded-lg bg-muted/60 px-3 py-2"><span className="text-xs text-muted-foreground">{t('Against last year ({n} months)', { n: done.length })}</span>
          <span className="text-lg font-bold">{sumB > 0 ? <ChangeChip pct={(sumA / sumB - 1) * 100} /> : '—'}</span></div>
        <div className="grid gap-0.5 rounded-lg bg-muted/60 px-3 py-2"><span className="text-xs text-muted-foreground">{t('Best month')}</span>
          <span className="truncate text-[15px] font-bold">{best ? `${best.title} · ${formatMoneyCompact(best.a, currency)}` : '—'}</span></div>
        <div className="grid gap-0.5 rounded-lg bg-muted/60 px-3 py-2"><span className="text-xs text-muted-foreground">{t('Monthly average')}</span>
          <span className="text-[15px] font-bold">{done.length ? formatMoney(sumA / done.length, currency) : '—'}</span></div>
      </div>
      <Legend items={[{ label: aLabel, color: C.one, kind: 'line' }, { label: bLabel, color: C.muted, kind: 'dash' }, ...(projI >= 0 ? [{ label: t('At this pace'), color: C.one, kind: 'dash' as const }] : [])]} />
      <div ref={ref} className="relative select-none" style={{ height }} onMouseLeave={() => setHv(null)}>
        {w > 0 && <>
          {ticks.map((v) => (
            <React.Fragment key={v}>
              <div className="absolute h-px" style={{ left: L, right: 44, top: y(v), background: C.grid, opacity: v === 0 ? 1 : 0.6 }} />
              <div className="absolute w-14 text-right text-[11px] text-muted-foreground" style={{ left: 0, top: y(v) - 8 }}>{v === 0 ? '0' : formatMoneyCompact(v, currency)}</div>
            </React.Fragment>
          ))}
          {done.length > 0 && (() => { const avg = sumA / done.length; return <>
            <div className="absolute border-t border-dashed border-muted-foreground/50" style={{ left: L, right: 44, top: y(avg) }} />
            <div className="absolute bg-card px-1 text-[11px] text-muted-foreground" style={{ left: L + 4, top: y(avg) - 16 }}>{t('average')} {formatMoneyCompact(avg, currency)}</div>
          </> })()}
          {hv != null && <div className="absolute w-px bg-foreground/25" style={{ left: cx(hv), top: T, height: PH }} />}
          <svg width={w} height={height} className="absolute inset-0 overflow-visible" aria-hidden>
            {area && <path d={area} fill={C.one} fillOpacity={0.1} />}
            <path d={path(rows.map((r) => r.b))} fill="none" stroke={C.muted} strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" />
            {proj && <path d={proj} fill="none" stroke={C.one} strokeWidth={2} strokeDasharray="2 4" strokeLinecap="round" />}
            <path d={line} fill="none" stroke={C.one} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
          </svg>
          {rows.map((r, i) => (
            <React.Fragment key={r.key}>
              <div className="absolute" style={{ left: L + i * slot, width: slot, top: T, height: PH }} onMouseEnter={() => setHv(i)} />
              <div className={cn('pointer-events-none absolute text-center text-[11px]', hv === i ? 'font-bold text-foreground' : 'text-muted-foreground')} style={{ left: L + i * slot, width: slot, top: T + PH + 7 }}>{r.label}</div>
            </React.Fragment>
          ))}
          {lastA >= 0 && <div className="pointer-events-none absolute text-xs font-bold" style={{ left: w - 40, top: y(rows[rows.length - 1]!.projected ?? aVals[lastA]!) - 8 }}>{aLabel}</div>}
          {rows[rows.length - 1]!.b != null && <div className="pointer-events-none absolute text-xs font-semibold text-muted-foreground" style={{ left: w - 40, top: y(rows[rows.length - 1]!.b!) - 8 }}>{bLabel}</div>}
          {cur && curA != null && <div className="pointer-events-none absolute size-2.5 rounded-full" style={{ left: cx(hv!) - 5, top: y(curA) - 5, background: C.one, boxShadow: `0 0 0 2px ${C.card}` }} />}
          {cur && cur.b != null && <div className="pointer-events-none absolute size-2.5 rounded-full" style={{ left: cx(hv!) - 5, top: y(cur.b) - 5, background: C.muted, boxShadow: `0 0 0 2px ${C.card}` }} />}
          {cur && (
            <Tip left={Math.min(Math.max(0, cx(hv!) + (hv! > rows.length / 2 ? -224 : 14)), w - 208)} top={Math.max(0, y(curA ?? cur.b ?? 0) - 30)}>
              <div className="text-[12.5px] font-bold">{cur.title}</div>
              <TipRow color={C.one} strong label={cur.projected != null ? `${aLabel} · ${t('at this pace')}` : aLabel} value={curA != null ? formatMoney(curA, currency) : '—'} />
              <TipRow color={C.muted} label={bLabel} value={cur.b != null ? formatMoney(cur.b, currency) : '—'} />
              {curA != null && cur.b ? <ChangeChip pct={(curA / cur.b - 1) * 100} label={t('vs last year')} /> : null}
            </Tip>
          )}
        </>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ C: the days of a month, as a calendar */

const SHADES = [0.12, 0.28, 0.48, 0.72, 1]
const shadeOf = (v: number, max: number) => (v <= 0 || max <= 0 ? -1 : Math.min(4, Math.floor((v / max) * 5 - 1e-9)))

export function DayCalendar({ month, days, currency }: { month: string; days: { d: string; value: number }[]; currency?: string | null }) {
  const first = new Date(`${month.slice(0, 7)}-01T00:00:00`)
  const lead = (first.getDay() + 6) % 7
  const n = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  const map = new Map(days.map((x) => [x.d.slice(0, 10), x.value]))
  const vals = days.map((x) => x.value)
  const max = Math.max(0, ...vals)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const best = days.reduce<{ d: string; value: number } | null>((b, x) => (!b || x.value > b.value ? x : b), null)
  const wd = [1, 2, 3, 4, 5, 6, 0].map((i) => formatDateWith(new Date(2026, 1, 1 + i), { weekday: 'short' }))
  const byDow = Array.from({ length: 7 }, () => ({ s: 0, n: 0 }))
  const cells: React.ReactNode[] = []
  let week = 0
  const weekTotal = () => {
    let s = 0
    for (let d = Math.max(1, week * 7 - lead + 1); d <= Math.min(n, week * 7 - lead + 7); d++) s += map.get(iso(first, d)) ?? 0
    return s
  }
  for (let i = 0; i < lead; i++) cells.push(<div key={`b${i}`} className="rounded-md bg-muted/40" />)
  for (let d = 1; d <= n; d++) {
    const key = iso(first, d), v = map.get(key), date = new Date(first.getFullYear(), first.getMonth(), d)
    const future = date > today
    const k = v != null ? shadeOf(v, max) : -1
    if (v != null && !future) { const dow = (date.getDay() + 6) % 7; byDow[dow]!.s += v; byDow[dow]!.n++ }
    cells.push(
      <div key={key} title={`${formatDateWith(date, { weekday: 'long', day: 'numeric', month: 'long' })}: ${v != null ? formatMoney(v, currency) : '—'}`}
        className={cn('flex min-h-[54px] flex-col justify-between rounded-md px-2 py-1.5', future ? 'border border-dashed text-muted-foreground' : k < 0 && 'bg-muted/50', best?.d.slice(0, 10) === key && max > 0 && 'ring-2 ring-foreground ring-inset')}
        style={k >= 0 && !future ? { background: `hsl(var(--primary) / ${SHADES[k]})`, color: k >= 3 ? 'hsl(var(--primary-foreground))' : undefined } : undefined}>
        <span className="text-[11px] font-semibold opacity-80">{d}</span>
        {!future && <span className="tabular truncate text-[12.5px] font-bold">{v != null && v !== 0 ? formatMoneyCompact(v, currency) : '—'}</span>}
      </div>,
    )
    if ((lead + d) % 7 === 0 || d === n) {
      if (d === n) for (let j = (lead + d) % 7; j > 0 && j < 7; j++) cells.push(<div key={`a${j}`} className="rounded-md bg-muted/40" />)
      const s = weekTotal(); week++
      cells.push(<div key={`w${week}`} className="flex min-h-[54px] flex-col justify-between rounded-md border px-2 py-1.5"><span className="text-[11px] font-semibold text-muted-foreground">{t('Week {n}', { n: week })}</span><span className="tabular truncate text-[12.5px] font-bold">{formatMoneyCompact(s, currency)}</span></div>)
    }
  }
  const avg = byDow.map((x) => (x.n ? x.s / x.n : 0))
  const bestDow = avg.indexOf(Math.max(...avg)), lowDow = avg.indexOf(Math.min(...avg.filter((v) => v > 0), Infinity))
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
        {best && max > 0 && <span><span className="text-muted-foreground">{t('Best day')}: </span><b>{formatDateWith(new Date(`${best.d.slice(0, 10)}T00:00:00`), { weekday: 'short', day: 'numeric', month: 'short' })} · {formatMoney(best.value, currency)}</b></span>}
        {avg[bestDow]! > 0 && lowDow >= 0 && avg[lowDow]! > 0 && bestDow !== lowDow && <span><span className="text-muted-foreground">{t('Strongest day of the week')}: </span><b>{wd[bestDow]}</b> <span className="text-muted-foreground">{t('{pct}% above {day}', { pct: Math.round((avg[bestDow]! / avg[lowDow]! - 1) * 100), day: wd[lowDow] })}</span></span>}
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[560px] gap-1.5" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr)) minmax(0, 1.1fr)' }}>
          {wd.map((d) => <div key={d} className="px-1 text-[11px] font-semibold text-muted-foreground">{d}</div>)}
          <div className="px-1 text-[11px] font-semibold text-muted-foreground">{t('Total')}</div>
          {cells}
        </div>
      </div>
      <ShadeLegend max={max} currency={currency} />
    </div>
  )
}
const iso = (first: Date, d: number) => `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

function ShadeLegend({ max, currency, unit }: { max: number; currency?: string | null; unit?: string }) {
  if (max <= 0) return null
  return (
    <div className="flex flex-wrap items-end gap-1.5 text-[11px] text-muted-foreground">
      <span className="pb-3.5">{t('less')}</span>
      {SHADES.map((s, i) => (
        <span key={s} className="grid gap-0.5"><span className="h-3 w-10 rounded-[3px]" style={{ background: `hsl(var(--primary) / ${s})` }} /><span className="tabular">{i === 0 ? '0' : formatMoneyCompact((max * i) / 5, currency)}</span></span>
      ))}
      <span className="pb-3.5">{t('more')}{unit ? ` (${unit})` : ''}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ F: the hours of each weekday */

export function HourHeatmap({ cells, dowDays, currency }: { cells: { dow: number; hour: number; net: number }[]; dowDays: Record<string, number>; currency?: string | null }) {
  const hours = cells.map((c) => c.hour)
  if (!hours.length) return <p className="py-8 text-center text-[13px] text-muted-foreground">{t('No sales at the tills in this month.')}</p>
  const h0 = Math.min(...hours), h1 = Math.max(...hours)
  const avg = new Map(cells.map((c) => [`${c.dow}-${c.hour}`, c.net / Math.max(1, dowDays[String(c.dow)] ?? 1)]))
  const max = Math.max(0, ...avg.values())
  let best = { k: '', v: 0 }
  avg.forEach((v, k) => { if (v > best.v) best = { k, v } })
  const wd = [1, 2, 3, 4, 5, 6, 0].map((i) => formatDateWith(new Date(2026, 1, 1 + i), { weekday: 'short' }))
  const wdLong = [1, 2, 3, 4, 5, 6, 0].map((i) => formatDateWith(new Date(2026, 1, 1 + i), { weekday: 'long' }))
  const hs = Array.from({ length: h1 - h0 + 1 }, (_, i) => h0 + i)
  const hh = (h: number) => `${String(h).padStart(2, '0')}:00`
  const [bd, bh] = best.k.split('-').map(Number)
  return (
    <div className="grid gap-3">
      {best.v > 0 && <div className="text-[13px]"><span className="text-muted-foreground">{t('Busiest hour')}: </span><b>{wdLong[(bd! + 6) % 7]}, {hh(bh!)}–{hh(bh! + 1)} · {formatMoney(best.v, currency)}</b> <span className="text-muted-foreground">{t('on average')}</span></div>}
      <div className="overflow-x-auto">
        <div className="grid min-w-[620px] gap-1" style={{ gridTemplateColumns: `40px repeat(${hs.length}, minmax(0, 1fr))` }}>
          <span />
          {hs.map((h) => <span key={h} className="text-center text-[11px] text-muted-foreground">{h}</span>)}
          {[1, 2, 3, 4, 5, 6, 7].map((dow, r) => (
            <React.Fragment key={dow}>
              <span className="self-center text-xs font-semibold">{wd[r]}</span>
              {hs.map((h) => {
                const v = avg.get(`${dow}-${h}`) ?? 0
                const k = shadeOf(v, max)
                return (
                  <span key={h} title={`${wdLong[r]}, ${hh(h)}–${hh(h + 1)}: ${formatMoney(v, currency)}`}
                    className={cn('flex h-9 items-center justify-center rounded-[5px] text-[11px] font-semibold tabular', k < 0 && 'bg-muted/50 text-muted-foreground', best.k === `${dow}-${h}` && 'ring-2 ring-foreground ring-inset')}
                    style={k >= 0 ? { background: `hsl(var(--primary) / ${SHADES[k]})`, color: k >= 3 ? 'hsl(var(--primary-foreground))' : undefined } : undefined}>
                    {v > 0 ? formatNumberWith(v, { maximumFractionDigits: 0 }) : ''}
                  </span>
                )
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
      <ShadeLegend max={max} currency={currency} unit={t('average an hour')} />
    </div>
  )
}

/* ------------------------------------------------------------------ E: the categories, with their margin */

export function CategoryBars({ rows, currency, lowMargin = 15 }: { rows: { name: string; net: number; cost: number | null }[]; currency?: string | null; lowMargin?: number }) {
  const total = rows.reduce((s, r) => s + r.net, 0)
  const top = Math.max(1, ...rows.map((r) => r.net))
  const costs = rows.some((r) => r.cost != null)
  const SCALE = 40
  if (!rows.length) return <p className="py-8 text-center text-[13px] text-muted-foreground">{t('No sales in this month.')}</p>
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[560px] items-center gap-x-4" style={{ gridTemplateColumns: costs ? 'minmax(120px, 0.8fr) minmax(0, 2fr) 64px minmax(150px, 1fr)' : 'minmax(120px, 0.8fr) minmax(0, 2fr) 64px' }}>
        <span className="border-b pb-2 text-xs font-semibold text-muted-foreground">{t('Category')}</span>
        <span className="border-b pb-2 text-xs font-semibold text-muted-foreground">{t('Sales without VAT')}</span>
        <span className="border-b pb-2 text-right text-xs font-semibold text-muted-foreground">{t('Share')}</span>
        {costs && <span className="border-b pb-2 text-xs font-semibold text-muted-foreground">{t('Gross margin (0–{n}%)', { n: SCALE })}</span>}
        {rows.map((r) => {
          const m = r.cost != null && r.net > 0 ? ((r.net - r.cost) / r.net) * 100 : null
          const low = m != null && m < lowMargin
          return (
            <React.Fragment key={r.name}>
              <span className="truncate border-b py-2.5 text-[13px] font-semibold">{r.name}</span>
              <span className="flex items-center gap-2 border-b py-2.5"><span className="h-4 rounded-r" style={{ width: `${Math.max(1, (r.net / top) * 80)}%`, background: C.one }} /><span className="tabular shrink-0 text-xs font-bold">{formatMoney(r.net, currency)}</span></span>
              <span className="tabular border-b py-2.5 text-right text-xs text-muted-foreground">{total ? pct1((r.net / total) * 100) : '0'}%</span>
              {costs && (
                <span className="relative flex h-full items-center border-b">
                  <span className="relative mr-14 h-0.5 flex-1 rounded bg-border">
                    <span className="absolute -top-2 border-l border-dashed border-warning/70" style={{ left: `${(lowMargin / SCALE) * 100}%`, height: 18 }} />
                    {m != null && <span className="absolute -top-[5px] size-3 rounded-full" style={{ left: `calc(${(Math.max(0, Math.min(m, SCALE)) / SCALE) * 100}% - 6px)`, background: low ? 'hsl(var(--warning))' : C.one, boxShadow: `0 0 0 2px ${C.card}` }} />}
                  </span>
                  <span className={cn('tabular absolute right-0 w-12 text-right text-xs font-bold', low && 'text-warning')}>{m != null ? `${pct1(m)}%` : '—'}</span>
                </span>
              )}
            </React.Fragment>
          )
        })}
      </div>
      {costs && <p className="mt-2 flex items-center gap-2 text-[11.5px] text-muted-foreground"><span className="h-3 border-l border-dashed border-warning" />{t('Below {n}% the margin shows in orange', { n: lowMargin })}</p>}
    </div>
  )
}

/* ------------------------------------------------------------------ D: from the sales to the profit */

export function Waterfall({ steps, currency, height = 300 }: { steps: { name: string; value: number; kind: 'total' | 'down' | 'up' | 'result' }[]; currency?: string | null; height?: number }) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const base = steps.find((s) => s.kind === 'total')?.value ?? 0
  let run = 0
  const geo = steps.map((s) => {
    let from: number, to: number
    if (s.kind === 'total' || s.kind === 'result') { from = 0; to = s.value; run = s.value } else { from = run; to = run + (s.kind === 'down' ? -Math.abs(s.value) : Math.abs(s.value)); run = to }
    return { ...s, from, to, after: run }
  })
  const hi = Math.max(1, ...geo.flatMap((g) => [g.from, g.to])), lo = Math.min(0, ...geo.flatMap((g) => [g.from, g.to]))
  const { top, ticks } = niceScale(hi)
  const neg = lo < 0 ? niceScale(-lo).top : 0
  const T = 24, B = 46, PH = height - T - B
  const y = (v: number) => T + PH * (1 - (v + neg) / (top + neg))
  const slot = steps.length ? (w - L - R) / steps.length : 0, bw = Math.max(18, Math.min(64, slot * 0.55))
  const x = (i: number) => L + i * slot + (slot - bw) / 2
  return (
    <div className="grid gap-3">
      <Legend items={[{ label: t('Amount'), color: C.muted }, { label: t('Costs'), color: C.cost }, { label: t('Result'), color: C.one }]} />
      <div ref={ref} className="relative" style={{ height }}>
        {w > 0 && <>
          {[...(neg ? [-neg] : []), ...ticks].map((v) => (
            <React.Fragment key={v}>
              <div className="absolute h-px" style={{ left: L, right: R, top: y(v), background: C.grid, opacity: v === 0 ? 1 : 0.6 }} />
              <div className="absolute w-14 text-right text-[11px] text-muted-foreground" style={{ left: 0, top: y(v) - 8 }}>{v === 0 ? '0' : formatMoneyCompact(v, currency)}</div>
            </React.Fragment>
          ))}
          {geo.map((g, i) => {
            const t0 = y(Math.max(g.from, g.to)), h = Math.max(2, Math.abs(y(g.from) - y(g.to)))
            const color = g.kind === 'down' ? C.cost : g.kind === 'result' ? (g.value < 0 ? 'hsl(var(--destructive))' : C.one) : g.kind === 'up' ? C.one : C.muted
            const label = g.kind === 'down' ? `−${formatMoneyCompact(Math.abs(g.value), currency)}` : formatMoneyCompact(g.value, currency)
            return (
              <React.Fragment key={g.name + i}>
                {i < geo.length - 1 && <div className="absolute border-t border-dashed border-muted-foreground/50" style={{ left: x(i) + bw, width: slot - bw, top: y(g.after) }} />}
                <div className="absolute" title={`${g.name}: ${formatMoney(g.value, currency)}`} style={{ left: x(i), width: bw, top: t0, height: h, background: color, borderRadius: g.kind === 'down' ? 3 : '4px 4px 0 0' }} />
                <div className="absolute text-center text-xs font-bold tabular" style={{ left: L + i * slot, width: slot, top: t0 - 19 }}>{label}</div>
                <div className="absolute grid gap-0.5 text-center" style={{ left: L + i * slot, width: slot, top: T + PH + 6 }}>
                  <span className="line-clamp-2 px-0.5 text-[11.5px] font-semibold leading-tight">{g.name}</span>
                  {base > 0 && g.kind !== 'total' && <span className="text-[10.5px] text-muted-foreground">{pct1((Math.abs(g.value) / base) * 100)}%</span>}
                </div>
              </React.Fragment>
            )
          })}
        </>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ G: the small line in a card */

export function Sparkline({ values, height = 36, className }: { values: number[]; height?: number; className?: string }) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const vs = values.filter((v) => isFinite(v))
  if (vs.length < 2) return null
  const lo = Math.min(...vs), hi = Math.max(...vs), pad = (hi - lo) * 0.12 || 1
  const x = (i: number) => (i / (values.length - 1)) * (w - 6) + 3
  const y = (v: number) => 3 + (height - 6) * (1 - (v - lo + pad) / (hi - lo + 2 * pad))
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  const last = values[values.length - 1]!
  return (
    <div ref={ref} className={cn('relative w-full', className)} style={{ height }} aria-hidden>
      {w > 0 && (
        <svg width={w} height={height} className="absolute inset-0 overflow-visible">
          <path d={`${line} L${x(values.length - 1).toFixed(1)} ${height} L${x(0).toFixed(1)} ${height} Z`} fill="hsl(var(--mod, 158 82%) var(--mod-l, 34%))" fillOpacity={0.1} />
          <path d={line} fill="none" stroke="hsl(var(--mod, 158 82%) var(--mod-l, 34%))" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={x(values.length - 1)} cy={y(last)} r={3} fill="hsl(var(--mod, 158 82%) var(--mod-l, 34%))" stroke={C.card} strokeWidth={1.5} />
        </svg>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ months that can go below zero (profit, cash flow) */

export function SignedBars({ rows, currency, height = 200, label }: { rows: { key: string; label: string; title: string; value: number }[]; currency?: string | null; height?: number; label: string }) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [hv, setHv] = React.useState<number | null>(null)
  const hi = Math.max(0, ...rows.map((r) => r.value)), lo = Math.min(0, ...rows.map((r) => r.value))
  const up = hi > 0 ? niceScale(hi, lo < 0 ? 2 : 4) : { top: 0, ticks: [0] }
  const down = lo < 0 ? niceScale(-lo, hi > 0 ? 2 : 4) : { top: 0, ticks: [0] }
  const T = 18, B = 24, PH = height - T - B
  const span = (up.top + down.top) || 1
  const y = (v: number) => T + PH * ((up.top - v) / span)
  const slot = rows.length ? (w - L - R) / rows.length : 0, bw = Math.max(6, Math.min(30, slot * 0.5))
  const ticks = [...down.ticks.filter((v) => v > 0).map((v) => -v), ...up.ticks]
  const cur = hv != null ? rows[hv] : null
  return (
    <div ref={ref} className="relative select-none" style={{ height }} onMouseLeave={() => setHv(null)}>
      {w > 0 && <>
        {ticks.map((v) => (
          <React.Fragment key={v}>
            <div className="absolute h-px" style={{ left: L, right: R, top: y(v), background: C.grid, opacity: v === 0 ? 1 : 0.6 }} />
            <div className="absolute w-14 text-right text-[11px] text-muted-foreground" style={{ left: 0, top: y(v) - 8 }}>{v === 0 ? '0' : formatMoneyCompact(v, currency)}</div>
          </React.Fragment>
        ))}
        {rows.map((r, i) => {
          const x = L + i * slot + (slot - bw) / 2, pos = r.value >= 0
          return (
            <React.Fragment key={r.key}>
              <div className={cn('absolute rounded-md', hv === i && 'bg-foreground/[0.05]')} style={{ left: L + i * slot, width: slot, top: T, height: PH }} onMouseEnter={() => setHv(i)} />
              {r.value !== 0 && <div className="pointer-events-none absolute" style={{ left: x, width: bw, top: pos ? y(r.value) : y(0), height: Math.max(1, Math.abs(y(r.value) - y(0))), background: pos ? C.one : C.cost, borderRadius: pos ? '4px 4px 0 0' : '0 0 4px 4px' }} />}
              <div className={cn('pointer-events-none absolute text-center text-[11px]', hv === i ? 'font-bold text-foreground' : 'text-muted-foreground')} style={{ left: L + i * slot, width: slot, top: T + PH + 6 }}>{r.label}</div>
            </React.Fragment>
          )
        })}
        {cur && (
          <Tip left={Math.min(Math.max(0, L + hv! * slot + (hv! > rows.length / 2 ? -212 : slot)), w - 208)} top={Math.max(0, y(Math.max(0, cur.value)) - 20)}>
            <div className="text-[12.5px] font-bold">{cur.title}</div>
            <TipRow color={cur.value >= 0 ? C.one : C.cost} strong label={label} value={formatMoney(cur.value, currency)} />
          </Tip>
        )}
      </>}
    </div>
  )
}
