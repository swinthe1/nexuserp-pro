import { CloudOff, RotateCw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { t } from '@/i18n'
import { describeError } from '@/lib/errors'
import { cn } from '@/lib/utils'

/** Shown in place of content when loading it failed. Says what happened in plain words and offers a retry. */
export function ErrorState({ error, onRetry, compact, className, title }: {
  error: unknown; onRetry?: () => void; compact?: boolean; className?: string; title?: string
}) {
  const offline = typeof navigator !== 'undefined' && !navigator.onLine
  const Icon = offline ? CloudOff : TriangleAlert
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center gap-2 px-6 text-center', compact ? 'py-10' : 'py-16', className)}>
      <span className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive"><Icon className="size-5" /></span>
      <p className="text-sm font-medium">{title ?? (offline ? t('You are offline') : t('This could not be loaded'))}</p>
      <p className="max-w-sm text-[13px] text-muted-foreground">{offline ? t('It will load again when the connection is back.') : describeError(error)}</p>
      {onRetry && <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}><RotateCw /> {t('Try again')}</Button>}
    </div>
  )
}
