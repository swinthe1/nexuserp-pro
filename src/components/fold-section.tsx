import { ChevronDown } from 'lucide-react'
import * as React from 'react'
import { cn } from '@/lib/utils'

/** A part of a page that stays folded to one line until it is opened; the choice is remembered on this device. */
export function FoldSection({ storeKey, title, hint, children, className }: {
  storeKey: string; title: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; className?: string
}) {
  const key = `drispro.fold.${storeKey}`
  const [open, setOpen] = React.useState(() => { try { return localStorage.getItem(key) === '1' } catch { return false } })
  const toggle = () => setOpen((o) => { try { localStorage.setItem(key, o ? '0' : '1') } catch { /* private window */ } return !o })
  return (
    <div className={cn('mt-4', className)}>
      <button type="button" onClick={toggle} aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg border bg-card px-4 py-2.5 text-left transition-colors hover:border-primary/40">
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', !open && '-rotate-90')} />
        <span className="font-medium">{title}</span>
        {hint && <span className="truncate text-[12.5px] text-muted-foreground">{hint}</span>}
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  )
}
