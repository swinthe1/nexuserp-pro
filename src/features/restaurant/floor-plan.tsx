import { Circle, RectangleHorizontal, Square, Undo2 } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { t, tn } from '@/i18n'

export type Shape = 'square' | 'round' | 'long'
export interface PlanTable { id: string; name: string; seats: number; x?: number | null; y?: number | null; shape?: string | null }

/** Size of a table on the plan, in percent of the room's width (the room is 16:10). */
export function tableBox(tb: PlanTable) {
  const s = Math.min(Math.max(tb.seats, 2), 12)
  const w = tb.shape === 'long' ? 9 + s * 1.4 : 7 + s * 0.6
  const h = tb.shape === 'long' ? 9 : w
  return { w, h: h * 1.6 }   // height in percent of the room's height
}
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

/** Drag the tables of one room to where they stand. Saves each table when it is dropped. */
export function FloorPlanEditor({ tables, onSave }: {
  tables: PlanTable[]
  onSave: (id: string, v: { pos_x?: number | null; pos_y?: number | null; shape?: Shape }) => Promise<void>
}) {
  const room = React.useRef<HTMLDivElement>(null)
  const [pos, setPos] = React.useState<Record<string, { x: number; y: number }>>({})
  const [selected, setSelected] = React.useState<string | null>(null)
  const drag = React.useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null)
  const placed = tables.filter((tb) => pos[tb.id] ?? (tb.x != null && tb.y != null))
  const waiting = tables.filter((tb) => !placed.includes(tb))
  const at = (tb: PlanTable) => pos[tb.id] ?? { x: Number(tb.x), y: Number(tb.y) }

  const toPct = (e: React.PointerEvent) => {
    const r = room.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 }
  }
  const down = (e: React.PointerEvent, tb: PlanTable) => {
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    const p = toPct(e); const c = at(tb)
    drag.current = { id: tb.id, dx: p.x - c.x, dy: p.y - c.y, moved: false }
    setSelected(tb.id)
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return
    const tb = tables.find((x) => x.id === d.id)!; const b = tableBox(tb); const p = toPct(e)
    d.moved = true
    setPos((s) => ({ ...s, [d.id]: { x: clamp(p.x - d.dx, b.w / 2, 100 - b.w / 2), y: clamp(p.y - d.dy, b.h / 2, 100 - b.h / 2) } }))
  }
  const up = () => {
    const d = drag.current; drag.current = null
    if (d?.moved && pos[d.id]) void onSave(d.id, { pos_x: Math.round(pos[d.id].x * 100) / 100, pos_y: Math.round(pos[d.id].y * 100) / 100 })
  }
  const place = (tb: PlanTable) => {
    // next free spot along a grid, so a click puts the table somewhere sensible
    const n = placed.length
    const p = { x: 12 + (n % 6) * 15, y: 16 + Math.floor(n / 6) * 26 }
    setPos((s) => ({ ...s, [tb.id]: p })); setSelected(tb.id)
    void onSave(tb.id, { pos_x: p.x, pos_y: Math.min(p.y, 85) })
  }
  const sel = tables.find((x) => x.id === selected)

  return (
    <div className="grid gap-2">
      <div ref={room} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        className="relative aspect-[16/10] w-full touch-none select-none overflow-hidden rounded-lg border bg-[radial-gradient(circle,hsl(var(--border))_1px,transparent_1px)] [background-size:16px_16px]"
        role="application" aria-label={t('Floor plan: drag the tables to where they stand')}>
        {placed.map((tb) => {
          const c = at(tb); const b = tableBox(tb)
          return (
            <button key={tb.id} type="button" onPointerDown={(e) => down(e, tb)}
              className={cn('absolute grid -translate-x-1/2 -translate-y-1/2 cursor-grab place-items-center border-2 bg-card text-xs font-semibold shadow-sm active:cursor-grabbing',
                tb.shape === 'round' ? 'rounded-full' : 'rounded-md', selected === tb.id ? 'border-primary' : 'border-foreground/25')}
              style={{ left: `${c.x}%`, top: `${c.y}%`, width: `${b.w}%`, height: `${b.h}%` }}>
              {tb.name}
            </button>
          )
        })}
        {placed.length === 0 && <p className="absolute inset-0 grid place-items-center px-6 text-center text-[13px] text-muted-foreground">{t('Click a table below to put it on the plan, then drag it to its place.')}</p>}
      </div>
      <div className="flex min-h-9 flex-wrap items-center gap-1.5">
        {waiting.length > 0 && <span className="text-xs text-muted-foreground">{tn(waiting.length, '{n} table not on the plan:', '{n} tables not on the plan:')}</span>}
        {waiting.map((tb) => <Button key={tb.id} type="button" size="sm" variant="outline" onClick={() => place(tb)}>{tb.name}</Button>)}
        {sel && placed.includes(sel) && (
          <span className="ml-auto flex items-center gap-1">
            <span className="mr-1 text-xs text-muted-foreground">{sel.name}:</span>
            {([['square', Square, t('Square')], ['round', Circle, t('Round')], ['long', RectangleHorizontal, t('Long')]] as const).map(([v, Icon, label]) => (
              <Button key={v} type="button" size="icon-sm" variant={(sel.shape ?? 'square') === v ? 'default' : 'outline'} aria-label={label} title={label}
                onClick={() => void onSave(sel.id, { shape: v })}><Icon /></Button>
            ))}
            <Button type="button" size="sm" variant="ghost" onClick={() => { setPos((s) => { const n = { ...s }; delete n[sel.id]; return n }); setSelected(null); void onSave(sel.id, { pos_x: null, pos_y: null }) }}>
              <Undo2 /> {t('Off the plan')}</Button>
          </span>
        )}
      </div>
    </div>
  )
}
