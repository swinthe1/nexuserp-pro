import { PageHelpButton } from '@/components/help'
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
  // one compact row: the way back, the title and its marks; the description in one line under it (all of it on hover)
  return (
    <div className={cn('mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between', className)}>
      <div className="flex min-w-0 items-center gap-2.5 sm:min-w-[min(100%,24rem)] sm:flex-1">
        {back && (
          <Link to={back.href} title={back.label} aria-label={back.label}
            className="inline-flex h-8 shrink-0 items-center gap-0.5 rounded-md border bg-background pl-1.5 pr-2.5 text-[12.5px] font-medium text-muted-foreground shadow-sm transition-colors hover:border-primary/50 hover:text-primary">
            <ChevronLeft className="size-4" /> <span className="max-w-[10rem] truncate">{back.label}</span>
          </Link>
        )}
        {icon && !back && <ModuleChip className="size-8 rounded-lg [&_svg]:size-4" />}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-[19px] font-semibold leading-tight tracking-[-0.015em]">{title}</h1>
            <PageHelpButton className="-ml-0.5" />
            {meta}
          </div>
          {description && <p className="mt-0.5 line-clamp-1 max-w-3xl text-[12.5px] text-muted-foreground" title={typeof description === 'string' ? description : undefined}>{description}</p>}
        </div>
      </div>
      {actions && <div className="flex min-w-0 max-w-full shrink-0 flex-wrap items-center gap-2 sm:ml-auto sm:justify-end print:hidden max-sm:[&_a]:whitespace-normal max-sm:[&_button]:whitespace-normal">{actions}</div>}
    </div>
  )
}
