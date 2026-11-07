import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export type StatTrend = {
  /** change in percent against the comparison (null when there is nothing to compare with) */
  pct: number | null
  /** what it is compared with, e.g. "vs last Friday" */
  label: string
  /** false for numbers where going up is bad (refunds, differences) */
  upIsGood?: boolean
}

export function StatCard({ label, value, hint, href, loading, tone = 'default', pending, icon: Icon, hue = '158 82%', trend, meter, unit }: {
  label: string
  /** a small icon in the corner, in its own colour (hue and saturation, as in app/modules.ts) */
  icon?: LucideIcon
  hue?: string
  value: React.ReactNode
  /** a small word after the number (%, items, receipts) */
  unit?: string
  hint?: React.ReactNode
  href?: string
  loading?: boolean
  tone?: 'default' | 'warning' | 'destructive' | 'success'
  /** module not built yet */
  pending?: string
  /** up or down against an earlier day or month */
  trend?: StatTrend
  /** a thin bar under the number, 0–100 (e.g. a margin) */
  meter?: number | null
}) {
  const body = (
    <div style={{ '--mod': hue } as React.CSSProperties}
      className={cn('stat-card relative flex h-full flex-col gap-1.5 overflow-hidden rounded-xl border bg-card p-4 shadow-card transition-[border-color,box-shadow,transform] duration-200',
        tone === 'destructive' && 'border-destructive/30', tone === 'warning' && 'border-warning/35',
        href && 'hover:-translate-y-px hover:border-primary/30 hover:shadow-[0_6px_16px_-6px_hsl(var(--primary)/0.25)]')}>
      <span className="relative flex items-start justify-between gap-2 text-[13px] font-semibold text-muted-foreground">
        <span className="pt-1 leading-snug">{label}</span>
        {Icon && <span className="mod-chip flex size-9 shrink-0 items-center justify-center rounded-[10px]"><Icon className="size-[18px]" strokeWidth={2} /></span>}
      </span>
      {loading ? (
        <Skeleton className="h-8 w-28" />
      ) : pending ? (
        <span className="text-lg font-medium text-muted-foreground/70">{pending}</span>
      ) : (
        <span className="relative flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className={cn('tabular text-[28px] font-bold leading-tight tracking-[-0.025em]', tone === 'warning' && 'text-warning', tone === 'destructive' && 'text-destructive', tone === 'success' && 'text-success')}>
            {value}{unit && <span className="ml-1 text-base font-semibold text-muted-foreground">{unit}</span>}
          </span>
          {trend && <TrendPill trend={trend} />}
        </span>
      )}
      {meter != null && !loading && (
        <span className="relative mt-0.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <span className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, meter))}%`, background: 'hsl(var(--mod) var(--mod-l))' }} />
        </span>
      )}
      {hint && <span className="relative text-xs text-muted-foreground">{hint}</span>}
    </div>
  )
  return href ? <Link to={href} className="rounded-xl focus-visible:ring-2 focus-visible:ring-ring">{body}</Link> : body
}

function TrendPill({ trend }: { trend: StatTrend }) {
  if (trend.pct == null || !isFinite(trend.pct)) return null
  const flat = Math.abs(trend.pct) < 0.5
  const up = trend.pct > 0
  const good = flat ? null : up === (trend.upIsGood ?? true)
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <span className={cn('inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular',
        good === null ? 'bg-muted text-muted-foreground' : good ? 'bg-success/15 text-success' : 'bg-destructive/10 text-destructive')}>
        <Icon className="size-3" strokeWidth={2.5} />{Math.abs(trend.pct).toLocaleString(undefined, { maximumFractionDigits: 0 })}%
      </span>
      {trend.label}
    </span>
  )
}
