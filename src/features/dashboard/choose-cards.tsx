import { ArrowDown, ArrowUp, SlidersHorizontal } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { msg, t } from '@/i18n'
import { cn } from '@/lib/utils'
import type { CardGroup } from './api'

type Card = { key: string; label: string; group: CardGroup }

const GROUPS: { key: CardGroup; label: string }[] = [
  { key: 'shop', label: msg('Shop and tills') }, { key: 'stock', label: msg('Goods') },
  { key: 'money', label: msg('Money') }, { key: 'office', label: msg('Buying and approvals') },
]

/**
 * "Choose cards": which numbers this person sees on the dashboard, and in what order. "Shown" lists
 * the chosen ones in their order; the groups hold everything there is to add.
 * Kept on their profile, per company, so every computer and phone shows the same.
 */
export function ChooseCards({ all, shown, usual, onSave }: { all: Card[]; shown: string[]; usual: string[]; onSave: (keys: string[] | null) => void }) {
  const [open, setOpen] = React.useState(false)
  const [order, setOrder] = React.useState<string[]>([])
  const [tab, setTab] = React.useState<'shown' | CardGroup>('shown')
  const start = () => { setOrder(shown); setTab('shown'); setOpen(true) }
  const byKey = new Map(all.map((c) => [c.key, c]))
  const move = (i: number, d: -1 | 1) => setOrder((o) => { const n = [...o]; const j = i + d; if (j < 0 || j >= n.length) return o; [n[i], n[j]] = [n[j]!, n[i]!]; return n })
  const toggle = (k: string) => setOrder((o) => (o.includes(k) ? o.filter((x) => x !== k) : [...o, k]))
  const list = tab === 'shown' ? order : all.filter((c) => c.group === tab).map((c) => c.key)
  return (
    <>
      <Button variant="outline" size="sm" onClick={start}><SlidersHorizontal /> {t('Choose cards')}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('Choose cards')}</DialogTitle>
            <DialogDescription>{t('Tick what you want to see on the dashboard; the arrows change the order. Only you see this choice.')}</DialogDescription>
          </DialogHeader>
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList className="h-auto flex-wrap">
              <TabsTrigger value="shown">{t('On the dashboard ({n})', { n: order.length })}</TabsTrigger>
              {GROUPS.filter((g) => all.some((c) => c.group === g.key)).map((g) => <TabsTrigger key={g.key} value={g.key}>{t(g.label)}</TabsTrigger>)}
            </TabsList>
          </Tabs>
          <ul className="grid max-h-[52vh] gap-1 overflow-y-auto pr-1">
            {!list.length && <li className="py-6 text-center text-sm text-muted-foreground">{t('No cards chosen: add some from the groups above.')}</li>}
            {list.map((k, i) => {
              const on = order.includes(k)
              return (
                <li key={k} className={cn('flex items-center gap-2 rounded-md border px-2 py-1.5', !on && 'opacity-70')}>
                  <label className="flex flex-1 cursor-pointer items-center gap-2.5 text-sm">
                    <Checkbox checked={on} onCheckedChange={() => toggle(k)} />
                    <span className="leading-snug">{byKey.get(k)?.label}</span>
                  </label>
                  {tab === 'shown' && <>
                    <Button type="button" variant="ghost" size="icon-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('Move up')}><ArrowUp /></Button>
                    <Button type="button" variant="ghost" size="icon-sm" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label={t('Move down')}><ArrowDown /></Button>
                  </>}
                </li>
              )
            })}
          </ul>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="ghost" onClick={() => { setOrder(usual); setTab('shown') }}>{t('Back to the usual cards')}</Button>
            <Button onClick={() => {
              const keys = order.filter((k) => byKey.has(k))
              // the usual set is kept as "usual", so it follows when the usual cards change
              onSave(keys.join() === usual.join() ? null : keys); setOpen(false)
            }}>{t('Save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
