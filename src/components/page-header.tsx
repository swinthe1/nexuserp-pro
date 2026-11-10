import { PageHelpButton } from '@/components/help'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useGoForward } from '@/components/layout/back-button'
import { useStackSection } from '@/components/page-stack'
import { t } from '@/i18n'
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
  const stack = useStackSection()
  // a page opened from a list (e.g. the Reports page) goes back there, whatever its own way back is
  const from = (useLocation().state as { backTo?: { href: string; label: string } } | null)?.backTo
  if (from?.href) back = from
  const fwd = useGoForward()
  // a page shown as a part of a bigger page: its header is the part's heading
  if (stack && !stack.first) {
    return (
      <div className={cn('mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between', className)}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><h2 className="text-[17px] font-semibold tracking-[-0.01em]">{title}</h2>{meta}</div>
          {description && <p className="mt-0.5 line-clamp-2 max-w-3xl text-[12.5px] text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex min-w-0 max-w-full shrink-0 flex-wrap items-center gap-2 sm:justify-end print:hidden">{actions}</div>}
      </div>
    )
  }
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
        {back && (
          <button type="button" onClick={fwd.go} disabled={!fwd.can} title={t('Forward one step')} aria-label={t('Forward one step')}
            className="-ml-1.5 inline-flex h-8 shrink-0 items-center gap-0.5 rounded-md border bg-background pl-2.5 pr-1.5 text-[12.5px] font-medium text-muted-foreground shadow-sm transition-colors hover:border-primary/50 hover:text-primary disabled:pointer-events-none disabled:opacity-40">
            <span>{t('Forward|step')}</span> <ChevronRight className="size-4" />
          </button>
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
      {stack?.links && <div className="basis-full">{stack.links}</div>}
    </div>
  )
}
