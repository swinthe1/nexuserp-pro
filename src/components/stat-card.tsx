import type { LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export function StatCard({ label, value, hint, href, loading, tone = 'default', pending, icon: Icon, hue = '158 82%' }: {
  label: string
  /** a small icon in the corner, in its own colour (hue and saturation, as in app/modules.ts) */
  icon?: LucideIcon
  hue?: string
  value: React.ReactNode
  hint?: React.ReactNode
  href?: string
  loading?: boolean
  tone?: 'default' | 'warning' | 'destructive'
  /** module not built yet */
  pending?: string
}) {
  const body = (
    <div className={cn('relative flex h-full flex-col gap-1.5 rounded-xl border bg-card p-4 shadow-card transition-[border-color,box-shadow,transform] duration-200',
      href && 'hover:-translate-y-px hover:border-primary/30 hover:shadow-[0_6px_16px_-6px_hsl(var(--primary)/0.25)]')}>
      <span className="flex items-center justify-between gap-2 text-[13px] font-medium text-muted-foreground">{label}
        {Icon && <span style={{ '--mod': hue } as React.CSSProperties} className="mod-chip flex size-8 shrink-0 items-center justify-center rounded-lg"><Icon className="size-4" strokeWidth={2} /></span>}</span>
      {loading ? (
        <Skeleton className="h-7 w-28" />
      ) : pending ? (
        <span className="text-lg font-medium text-muted-foreground/70">{pending}</span>
      ) : (
        <span className={cn('tabular text-[26px] font-bold leading-tight tracking-[-0.025em]', tone === 'warning' && 'text-warning', tone === 'destructive' && 'text-destructive')}>
          {value}
        </span>
      )}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  )
  return href ? <Link to={href} className="rounded-xl focus-visible:ring-2 focus-visible:ring-ring">{body}</Link> : body
}
