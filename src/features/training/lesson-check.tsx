import { CheckCircle2, CircleHelp, XCircle } from 'lucide-react'
import * as React from 'react'
import { t, useLocale } from '@/i18n'
import type { Check, L } from '@/i18n/help/types'
import { cn } from '@/lib/utils'

export function usePickL() {
  const locale = useLocale()
  return React.useCallback((x: L) => (locale === 'sq' ? x.sq : x.en), [locale])
}

/**
 * The lesson's one question: pick an answer; the right one closes the lesson (onRight), a wrong one shows
 * why and lets you pick again.
 */
export function LessonCheck({ check, onRight, done }: { check: Check; onRight: () => unknown; done?: boolean }) {
  const pick = usePickL()
  const [chosen, setChosen] = React.useState<number | null>(done ? check.answer : null)
  const right = chosen === check.answer
  return (
    <div className="grid gap-2">
      <p className="flex items-start gap-2 text-[13.5px] font-semibold"><CircleHelp className="mt-0.5 size-4 shrink-0 text-primary" />{pick(check.q)}</p>
      <div role="radiogroup" aria-label={pick(check.q)} className="grid gap-1.5">
        {check.options.map((o, i) => {
          const picked = chosen === i
          return (
            <button key={i} type="button" role="radio" aria-checked={picked} disabled={right && !picked}
              onClick={() => { setChosen(i); if (i === check.answer) void onRight() }}
              className={cn('rounded-lg border px-3 py-2 text-left text-[13px] transition-colors hover:bg-muted/60 disabled:opacity-60',
                picked && i === check.answer && 'border-success bg-success/10 hover:bg-success/10',
                picked && i !== check.answer && 'border-destructive bg-destructive/10 hover:bg-destructive/10')}>
              {pick(o)}
            </button>
          )
        })}
      </div>
      {chosen !== null && (
        <p className={cn('flex items-start gap-2 rounded-lg p-2.5 text-[13px]', right ? 'bg-success/10' : 'bg-destructive/10')} role="status">
          {right ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />}
          <span><span className="font-semibold">{right ? t('Right.') : t('Not quite. Try again.')}</span> {pick(check.explain)}</span>
        </p>
      )}
    </div>
  )
}
