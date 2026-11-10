import { PageHelpButton } from '@/components/help'
import { ChevronLeft, Minus, Plus } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { t } from '@/i18n'
import { cn, formatQty } from '@/lib/utils'

/** Frame for the handheld screens: narrow, big type, back link, one job per screen */
export function ScanShell({ title, back, meta, actions, children, className }: {
  title: React.ReactNode; back?: { href: string; label: string }; meta?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string
}) {
  return (
    <div className={cn('mx-auto grid max-w-3xl gap-4 pb-24', className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {back && <Link to={back.href} className="mb-1 inline-flex items-center gap-0.5 text-[13px] text-muted-foreground hover:text-foreground"><ChevronLeft className="size-4" /> {back.label}</Link>}
          <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold tracking-[-0.01em]">{title}</h1><PageHelpButton />{meta}</div>
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  )
}

/** Big "count / of" figure used on scan screens */
export function Progress({ done, total, className }: { done: number; total: number; className?: string }) {
  const pct = total ? Math.min(100, (done / total) * 100) : 0
  return (
    <div className={cn('grid gap-1', className)}>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full transition-[width] duration-300', done > total ? 'bg-warning' : 'bg-primary')} style={{ width: `${pct}%` }} />
      </div>
      <div className="text-xs text-muted-foreground tabular">{t('{done} of {total}', { done: formatQty(done), total: formatQty(total) })}</div>
    </div>
  )
}

/** Quantity entry with large steppers (gloves, small screens) */
export function QtyDialog({ open, title, description, initial, max, onClose, onSubmit, submitLabel }: {
  open: boolean; title: string; description?: React.ReactNode; initial: number; max?: number
  onClose: () => void; onSubmit: (qty: number) => void; submitLabel?: string
}) {
  const [v, setV] = React.useState(String(initial))
  React.useEffect(() => { if (open) setV(String(initial)) }, [open, initial])
  const n = Number(v)
  const valid = v !== '' && Number.isFinite(n) && n >= 0 && (max == null || n <= max)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{title}</DialogTitle>{description && <DialogDescription>{description}</DialogDescription>}</DialogHeader>
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (valid) onSubmit(n) }}>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" className="size-14 shrink-0" aria-label={t('One less')} onClick={() => setV(String(Math.max(0, (Number(v) || 0) - 1)))}><Minus className="size-5" /></Button>
            <Input autoFocus inputMode="decimal" className="h-14 text-center text-2xl font-semibold tabular" value={v} onChange={(e) => setV(e.target.value.replace(',', '.'))}
              onFocus={(e) => e.target.select()} aria-label={t('Quantity')} />
            <Button type="button" variant="outline" className="size-14 shrink-0" aria-label={t('One more')} onClick={() => setV(String((Number(v) || 0) + 1))}><Plus className="size-5" /></Button>
          </div>
          {max != null && <p className="-mt-2 text-center text-xs text-muted-foreground">{t('Up to {n}', { n: formatQty(max) })}</p>}
          <DialogFooter><Button type="button" variant="ghost" onClick={onClose}>{t('Cancel')}</Button><Button type="submit" disabled={!valid}>{submitLabel ?? t('Set quantity')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Short status line state for scan screens */
export function useScanStatus() {
  const [status, setStatus] = React.useState<{ tone: 'ok' | 'error' | 'info'; text: string } | null>(null)
  const ok = React.useCallback((text: string) => setStatus({ tone: 'ok', text }), [])
  const error = React.useCallback((text: string) => setStatus({ tone: 'error', text }), [])
  const info = React.useCallback((text: string) => setStatus({ tone: 'info', text }), [])
  return { status, ok, error, info, clear: () => setStatus(null) }
}
