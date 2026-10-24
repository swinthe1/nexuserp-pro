import { ChevronLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'

export function PageHeader({ title, description, actions, back, meta, className }: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  back?: { href: string; label: string }
  meta?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        {back && (
          <Link to={back.href} className="mb-1.5 inline-flex items-center gap-0.5 text-[13px] text-muted-foreground hover:text-foreground">
            <ChevronLeft className="size-4" /> {back.label}
          </Link>
        )}
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="truncate text-xl font-semibold tracking-[-0.01em]">{title}</h1>
          {meta}
        </div>
        {description && <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 print:hidden">{actions}</div>}
    </div>
  )
}
