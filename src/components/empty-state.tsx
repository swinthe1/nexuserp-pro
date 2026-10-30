import type { LucideIcon } from 'lucide-react'
import { Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'

export function EmptyState({ icon: Icon = Inbox, title, description, action, compact, className }: {
  icon?: LucideIcon; title: string; description?: string; action?: React.ReactNode; compact?: boolean; className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 text-center', compact ? 'py-12' : 'py-20', className)}>
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" />
      </span>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-sm text-[13px] text-muted-foreground">{description}</p>}
      {action && <div className="mt-2 max-w-full [&_a]:whitespace-normal [&_button]:whitespace-normal">{action}</div>}
    </div>
  )
}
