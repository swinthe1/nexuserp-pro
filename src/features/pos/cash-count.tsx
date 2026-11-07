/**
 * Counting the drawer by note and coin: the cashier at the close and at a recount, the manager when
 * reconciling. The manager sees the cashier's count of each note beside their own, so a difference is
 * found at once (two notes of 20 counted as one of 50, a roll of coins left out).
 */
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { t } from '@/i18n'
import { cn, formatMoney, num } from '@/lib/utils'

/** the notes and coins of the company's currency, largest first */
export const DENOMS: Record<string, number[]> = {
  EUR: [500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05],
  ALL: [10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 1],
}
export const denomsOf = (currency: string | null | undefined) => DENOMS[currency ?? ''] ?? DENOMS.EUR!
export const denomLabel = (d: number) => (d >= 1 ? String(d) : d.toFixed(2).replace('.', ','))
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

export type Counts = Record<number, string>
export const countsTotal = (denoms: number[], counts: Counts) => r2(denoms.reduce((s, d) => s + d * num(counts[d]), 0))
/** what is kept with the count: { "20": 3, "0.5": 4 } (only the notes counted) */
export const countsToNotes = (denoms: number[], counts: Counts) => {
  const out = Object.fromEntries(denoms.filter((d) => num(counts[d]) > 0).map((d) => [String(d), num(counts[d])]))
  return Object.keys(out).length ? out : null
}
/** a count kept earlier, by its note: the value of the key */
const kept = (notes: Record<string, number> | null | undefined, d: number) => {
  if (!notes) return 0
  const k = Object.keys(notes).find((x) => Math.abs(Number(x) - d) < 1e-9)
  return k ? num(notes[k]) : 0
}

/** the notes and coins, and the total typed whole instead when the person prefers */
export function CashCount({ currency, counts, onCounts, direct, onDirect, byNotes = true, compare, compareLabel, autoFocus, totalLabel }: {
  currency: string; counts: Counts; onCounts: (c: Counts) => void; direct: string; onDirect: (v: string) => void
  /** the company counts by note and coin (otherwise only the total) */
  byNotes?: boolean
  /** another count of the same drawer, by note (the cashier's), shown beside each line */
  compare?: Record<string, number> | null; compareLabel?: string
  autoFocus?: boolean; totalLabel?: string
}) {
  const denoms = denomsOf(currency)
  const total = countsTotal(denoms, counts)
  const withCompare = !!compare && Object.keys(compare).length > 0
  return (
    <div className="grid content-start gap-2">
      {byNotes && <>
        <div className="flex items-baseline justify-between">
          <Label>{t('Count by note and coin')}</Label>
          {withCompare && <span className="text-[11.5px] text-muted-foreground">{compareLabel ?? t('The cashier')}</span>}
        </div>
        <div className={cn('grid gap-1.5', withCompare ? 'grid-cols-1' : 'grid-cols-2')}>
          {denoms.map((d, i) => {
            const theirs = kept(compare, d)
            const mine = num(counts[d])
            const off = withCompare && (counts[d] ?? '') !== '' && mine !== theirs
            return (
              <label key={d} className="flex items-center gap-2 text-[13px]">
                <span className="w-12 shrink-0 text-right tabular text-muted-foreground">{denomLabel(d)}</span>
                <Input inputMode="numeric" autoFocus={autoFocus && i === 0} className={cn('h-8 tabular', off && 'border-warning ring-1 ring-warning/40')} value={counts[d] ?? ''}
                  onChange={(e) => { onDirect(''); onCounts({ ...counts, [d]: e.target.value.replace(/\D/g, '') }) }} aria-label={t('Count of {value}', { value: denomLabel(d) })} />
                {withCompare && <span className={cn('w-24 shrink-0 text-right text-[12px] tabular', off ? 'font-medium text-warning' : 'text-muted-foreground')}>
                  {theirs ? `× ${theirs} = ${formatMoney(theirs * d)}` : '—'}</span>}
              </label>
            )
          })}
        </div>
      </>}
      <Label htmlFor="cc-total" className={cn(byNotes && 'mt-1')}>{byNotes ? t('…or the total counted') : totalLabel ?? t('Cash counted in the drawer')}</Label>
      <Input id="cc-total" inputMode="decimal" autoFocus={autoFocus && !byNotes} className="h-11 text-right text-lg tabular" value={direct}
        onChange={(e) => onDirect(e.target.value.replace(',', '.').replace(/[^\d.]/g, ''))} placeholder={formatMoney(total)} />
    </div>
  )
}
/** the amount counted: the total typed, or the notes added up */
export const countedOf = (currency: string, counts: Counts, direct: string) => (direct !== '' ? num(direct) : countsTotal(denomsOf(currency), counts))
