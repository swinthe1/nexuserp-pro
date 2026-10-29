import { ArrowDown, ArrowUp, SlidersHorizontal } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

type Card = { key: string; label: string }

/**
 * "Choose cards": which numbers this person sees on the dashboard, and in what order.
 * Kept on their profile, per company, so every computer and phone shows the same.
 */
export function ChooseCards({ all, shown, onSave }: { all: Card[]; shown: string[]; onSave: (keys: string[] | null) => void }) {
  const [open, setOpen] = React.useState(false)
  const [order, setOrder] = React.useState<string[]>([])
  const [on, setOn] = React.useState<Set<string>>(new Set())
  const start = () => {
    // the chosen ones first, in their order, then the rest
    setOrder([...shown, ...all.map((c) => c.key).filter((k) => !shown.includes(k))])
    setOn(new Set(shown)); setOpen(true)
  }
  const label = new Map(all.map((c) => [c.key, c.label]))
  const move = (i: number, d: -1 | 1) => setOrder((o) => { const n = [...o]; const j = i + d; if (j < 0 || j >= n.length) return o; [n[i], n[j]] = [n[j]!, n[i]!]; return n })
  const toggle = (k: string) => setOn((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  return (
    <>
      <Button variant="outline" size="sm" onClick={start}><SlidersHorizontal /> {t('Choose cards')}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('Choose cards')}</DialogTitle>
            <DialogDescription>{t('Tick what you want to see on the dashboard; the arrows change the order. Only you see this choice.')}</DialogDescription>
          </DialogHeader>
          <ul className="grid max-h-[60vh] gap-1 overflow-y-auto pr-1">
            {order.map((k, i) => (
              <li key={k} className={cn('flex items-center gap-2 rounded-md border px-2 py-1.5', !on.has(k) && 'opacity-60')}>
                <label className="flex flex-1 cursor-pointer items-center gap-2.5 text-sm">
                  <Checkbox checked={on.has(k)} onCheckedChange={() => toggle(k)} />
                  <span className="leading-snug">{label.get(k)}</span>
                </label>
                <Button type="button" variant="ghost" size="icon-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('Move up')}><ArrowUp /></Button>
                <Button type="button" variant="ghost" size="icon-sm" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label={t('Move down')}><ArrowDown /></Button>
              </li>
            ))}
          </ul>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="ghost" onClick={() => { onSave(null); setOpen(false) }}>{t('Back to the usual cards')}</Button>
            <Button onClick={() => { onSave(order.filter((k) => on.has(k))); setOpen(false) }}>{t('Save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
