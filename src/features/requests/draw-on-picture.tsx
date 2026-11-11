import { Eraser, MoveUpRight, Pencil, Square, Undo2 } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

type Tool = 'pen' | 'box' | 'arrow'
type Mark = { tool: Tool; color: string; pts: [number, number][] }
const COLORS = ['#e11d48', '#f59e0b', '#2563eb', '#16a34a']

function paint(g: CanvasRenderingContext2D, m: Mark, w: number) {
  g.strokeStyle = m.color; g.fillStyle = m.color; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round'
  const [a, b] = [m.pts[0], m.pts[m.pts.length - 1]]
  if (!a) return
  if (m.tool === 'pen') {
    g.beginPath(); g.moveTo(a[0], a[1]); for (const p of m.pts.slice(1)) g.lineTo(p[0], p[1]); g.stroke()
  } else if (m.tool === 'box') {
    g.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))
  } else {
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), head = w * 4.5
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke()
    g.beginPath(); g.moveTo(b[0], b[1])
    g.lineTo(b[0] - head * Math.cos(ang - 0.45), b[1] - head * Math.sin(ang - 0.45))
    g.lineTo(b[0] - head * Math.cos(ang + 0.45), b[1] - head * Math.sin(ang + 0.45))
    g.closePath(); g.fill()
  }
}

/** draw on the picture of the screen: a pen, a box or an arrow, in four colours; the drawing goes into the picture */
export function DrawOnPicture({ picture, onDone, onClose }: { picture: Blob; onDone: (b: Blob) => void; onClose: () => void }) {
  const canvas = React.useRef<HTMLCanvasElement>(null)
  const [img, setImg] = React.useState<HTMLImageElement | null>(null)
  const [marks, setMarks] = React.useState<Mark[]>([])
  const [tool, setTool] = React.useState<Tool>('pen')
  const [color, setColor] = React.useState(COLORS[0])
  const drawing = React.useRef<Mark | null>(null)

  React.useEffect(() => {
    const u = URL.createObjectURL(picture)
    const i = new Image(); i.onload = () => setImg(i); i.src = u
    return () => URL.revokeObjectURL(u)
  }, [picture])

  const line = img ? Math.max(3, Math.round(img.width / 400)) : 3
  const redraw = React.useCallback((extra?: Mark | null) => {
    const c = canvas.current, g = c?.getContext('2d')
    if (!c || !g || !img) return
    g.drawImage(img, 0, 0)
    for (const m of marks) paint(g, m, line)
    if (extra) paint(g, extra, line)
  }, [img, marks, line])
  React.useEffect(() => { if (img && canvas.current) { canvas.current.width = img.width; canvas.current.height = img.height; redraw() } }, [img, redraw])

  const at = (e: React.PointerEvent): [number, number] => {
    const c = canvas.current!, r = c.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height]
  }
  const down = (e: React.PointerEvent) => { e.currentTarget.setPointerCapture(e.pointerId); drawing.current = { tool, color, pts: [at(e)] } }
  const move = (e: React.PointerEvent) => {
    const d = drawing.current
    if (!d) return
    if (d.tool === 'pen') d.pts.push(at(e)); else d.pts = [d.pts[0], at(e)]
    redraw(d)
  }
  const up = () => { const d = drawing.current; drawing.current = null; if (d && d.pts.length > 1) setMarks((m) => [...m, d]); else redraw() }
  const save = () => canvas.current?.toBlob((b) => { if (b) onDone(b) }, 'image/jpeg', 0.9)

  const tools: { key: Tool; label: string; icon: React.ReactNode }[] = [
    { key: 'pen', label: t('Pen'), icon: <Pencil /> },
    { key: 'box', label: t('Box'), icon: <Square /> },
    { key: 'arrow', label: t('Arrow'), icon: <MoveUpRight /> },
  ]
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-[min(96vw,1400px)]">
        <DialogHeader>
          <DialogTitle>{t('Draw on the picture')}</DialogTitle>
          <DialogDescription>{t('Circle, mark or point with an arrow at what you mean.')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            {tools.map((x) => (
              <button key={x.key} type="button" onClick={() => setTool(x.key)} aria-pressed={tool === x.key}
                className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm [&_svg]:size-4', tool === x.key ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                {x.icon}{x.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5" role="radiogroup" aria-label={t('Colour')}>
            {COLORS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} onClick={() => setColor(c)}
                className={cn('size-7 rounded-full border-2', color === c ? 'border-foreground' : 'border-transparent')} style={{ background: c }} />
            ))}
          </div>
          <Button size="sm" variant="ghost" disabled={!marks.length} onClick={() => setMarks((m) => m.slice(0, -1))}><Undo2 /> {t('Undo')}</Button>
          <Button size="sm" variant="ghost" disabled={!marks.length} onClick={() => setMarks([])}><Eraser /> {t('Clear the drawing')}</Button>
        </div>
        <div className="flex justify-center rounded-lg border bg-muted/30">
          <canvas ref={canvas} className="block h-auto max-h-[65vh] w-auto max-w-full touch-none cursor-crosshair" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button onClick={save}>{t('Keep the drawing')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
