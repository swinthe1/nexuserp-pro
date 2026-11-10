import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn, formatQty, num } from '@/lib/utils'
import { unitOfVariant } from '@/lib/units'
import { t } from '@/i18n'

/**
 * The split stock bar: reserved (dark) + available (blue) against a track sized
 * to max(on hand, reorder max). A tick marks the reorder point; the bar turns
 * amber when available ≤ reorder point and red when stock is negative.
 */
export function StockBar({ onHand, reserved, min, max, className, showLabel = true, unit, variantId }: {
  onHand: number | string | null
  reserved: number | string | null
  min?: number | string | null
  max?: number | string | null
  className?: string
  showLabel?: boolean
  /** the unit the quantities are in (a code or a name), or the item it is found from */
  unit?: string | null
  variantId?: string | null
}) {
  const u = unit ?? unitOfVariant(variantId) ?? undefined
  const q = (v: number) => formatQty(v, u)
  const oh = num(onHand)
  const res = Math.max(0, num(reserved))
  const avail = oh - res
  const minQ = min === null || min === undefined ? null : num(min)
  const scale = Math.max(oh, num(max), (minQ ?? 0) * 2, 1)
  const low = minQ !== null && avail <= minQ
  const negative = oh < 0
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / scale) * 100))}%`

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn('flex min-w-[120px] items-center gap-2', className)}>
          <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
            {!negative && (
              <>
                <div className="absolute inset-y-0 left-0 bg-foreground/55" style={{ width: pct(Math.min(res, oh)) }} />
                <div
                  className={cn('absolute inset-y-0', low ? 'bg-warning' : 'bg-primary')}
                  style={{ left: pct(Math.min(res, oh)), width: pct(Math.max(avail, 0)) }}
                />
              </>
            )}
            {negative && <div className="absolute inset-0 bg-destructive/70" />}
            {minQ !== null && minQ > 0 && <div className="absolute inset-y-[-2px] w-px bg-foreground/70" style={{ left: pct(minQ) }} />}
          </div>
          {showLabel && (
            <span className={cn('min-w-14 shrink-0 whitespace-nowrap text-right tabular text-[13px]', negative ? 'text-destructive' : low ? 'text-warning' : '')}>
              {q(avail)}
            </span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent>
        {t('On hand {a} · reserved {b} · available {c}', { a: q(oh), b: q(res), c: q(avail) })}
        {minQ !== null ? t(' · reorder at {n}', { n: q(minQ) }) : ''}
      </TooltipContent>
    </Tooltip>
  )
}
