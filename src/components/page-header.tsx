import { ChevronLeft } from 'lucide-react'
import * as React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { moduleLook, sectionOf } from '@/app/modules'
import { cn } from '@/lib/utils'

/** the coloured icon of the menu part a page belongs to */
export function ModuleChip({ pathname, className }: { pathname?: string; className?: string }) {
  const loc = useLocation()
  const hit = sectionOf(pathname ?? loc.pathname)
  if (!hit) return null
  const look = moduleLook(hit.section)
  const Icon = hit.icon
  return (
    <span aria-hidden style={{ '--mod': look.hue } as React.CSSProperties}
      className={cn('mod-chip flex size-10 shrink-0 items-center justify-center rounded-xl', className)}>
      <Icon className="size-5" strokeWidth={1.9} />
    </span>
  )
}

export function PageHeader({ title, description, actions, back, meta, className, icon = true }: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  back?: { href: string; label: string }
  meta?: React.ReactNode
  className?: string
  /** the coloured module icon beside the title */
  icon?: boolean
}) {
  return (
    <div className={cn('mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        {back && (
          <Link to={back.href} className="mb-2 inline-flex items-center gap-0.5 text-[13px] font-medium text-muted-foreground hover:text-primary">
            <ChevronLeft className="size-4" /> {back.label}
          </Link>
        )}
        <div className="flex items-center gap-3">
          {icon && !back && <ModuleChip />}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="truncate text-[22px] font-bold leading-tight tracking-[-0.02em]">{title}</h1>
              {meta}
            </div>
            {description && <p className="mt-0.5 max-w-2xl text-[13px] text-muted-foreground">{description}</p>}
          </div>
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 print:hidden">{actions}</div>}
    </div>
  )
}
