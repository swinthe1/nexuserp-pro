import { Link } from 'react-router-dom'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export function StatCard({ label, value, hint, href, loading, tone = 'default', pending }: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  href?: string
  loading?: boolean
  tone?: 'default' | 'warning' | 'destructive'
  /** module not built yet */
  pending?: string
}) {
  const body = (
    <div className={cn('flex h-full flex-col gap-1 rounded-lg border bg-card p-4 transition-colors', href && 'hover:border-ring/40')}>
      <span className="text-[13px] text-muted-foreground">{label}</span>
      {loading ? (
        <Skeleton className="h-7 w-28" />
      ) : pending ? (
        <span className="text-lg font-medium text-muted-foreground/70">{pending}</span>
      ) : (
        <span className={cn('tabular text-2xl font-semibold tracking-[-0.02em]', tone === 'warning' && 'text-warning', tone === 'destructive' && 'text-destructive')}>
          {value}
        </span>
      )}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  )
  return href ? <Link to={href} className="rounded-lg focus-visible:ring-2 focus-visible:ring-ring">{body}</Link> : body
}
