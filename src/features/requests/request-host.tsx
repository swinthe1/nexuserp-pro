import { Check, Crosshair, ImagePlus, Lightbulb, Loader2, Sparkles, X } from 'lucide-react'
import * as React from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { activePage } from '@/components/layout/work-tabs'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { getLocale, t, tServer } from '@/i18n'
import { describeError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { KINDS, reqNo, useRequestsOn, useSubmitRequest, writeOutInDetail, type RequestKind } from './api'

const EVENT = 'drispro:request'
/** opens the request window from anywhere (the top bar, a right click on the menu) */
export function openRequest(target?: string | null, pick?: boolean) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { target: target ?? null, pick: !!pick } }))
}

const clean = (s: string | null | undefined, n = 80) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const textOf = (el: Element | null | undefined) => clean(el?.getAttribute('aria-label') || (el as HTMLElement | null)?.innerText || el?.textContent)

/** the spot the person pointed at, in words: a menu line, a column, a field, a button */
export function describeSpot(el: Element): string {
  const nav = el.closest('aside, nav')
  if (nav) {
    const a = el.closest('a, button')
    const href = a?.getAttribute('href')
    return `${t('Menu')}: ${textOf(a ?? el)}${href ? ` (${href})` : ''}`
  }
  const th = el.closest('th')
  if (th) return `${t('Column')}: ${textOf(th)}`
  const cell = el.closest('td') as HTMLTableCellElement | null
  if (cell) {
    const head = cell.closest('table')?.querySelector('thead tr')?.children[cell.cellIndex]
    return `${t('Column')}: ${textOf(head) || '?'}, ${t('row')}: ${textOf(cell.closest('tr')?.children[0])}`
  }
  const field = el.closest('input, textarea, select, [role="combobox"]')
  if (field) {
    const id = field.getAttribute('id')
    const label = (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) || field.parentElement?.querySelector('label') || field.parentElement?.parentElement?.querySelector('label')
    return `${t('Field')}: ${textOf(label) || field.getAttribute('aria-label') || field.getAttribute('placeholder') || '?'}`
  }
  const btn = el.closest('button, a, [role="tab"]')
  if (btn) return `${t('Button')}: ${textOf(btn)}`
  const head = el.closest('h1, h2, h3, [role="heading"]')
  if (head) return `${t('Title')}: ${textOf(head)}`
  return `${t('Spot')}: ${textOf(el) || el.tagName.toLowerCase()}`
}

/** a picture of what is on the screen, the spot marked in red; nothing if the browser cannot make one in time */
async function screenPicture(mark?: DOMRect | null): Promise<Blob | null> {
  try {
    const { default: html2canvas } = await import('html2canvas')
    const scale = Math.min(1, 1600 / window.innerWidth)
    const canvas = await Promise.race([
      html2canvas(document.body, { x: window.scrollX, y: window.scrollY, width: window.innerWidth, height: window.innerHeight, scale, logging: false,
        useCORS: true, ignoreElements: (el) => el instanceof HTMLElement && el.hasAttribute('data-req-ignore') }),
      new Promise<null>((r) => setTimeout(() => r(null), 8000)),
    ])
    if (!canvas) return null
    if (mark) {
      const g = canvas.getContext('2d')
      if (g) { g.strokeStyle = '#e11d48'; g.lineWidth = 3; g.strokeRect((mark.left - 3) * scale, (mark.top - 3) * scale, (mark.width + 6) * scale, (mark.height + 6) * scale) }
    }
    return await new Promise((r) => canvas.toBlob((b) => r(b), 'image/jpeg', 0.75))
  } catch { return null }
}

/** "point at the spot": the next click on the page is not a click, it names the spot */
function Picker({ onDone }: { onDone: (r: { target: string; rect: DOMRect } | null) => void }) {
  const [box, setBox] = React.useState<DOMRect | null>(null)
  React.useEffect(() => {
    const ours = (e: Event) => (e.target as Element | null)?.closest?.('[data-req-ignore]')
    const move = (e: MouseEvent) => { if (!ours(e)) setBox((e.target as Element).getBoundingClientRect()) }
    const stop = (e: Event) => { if (ours(e)) return; e.preventDefault(); e.stopPropagation() }
    const click = (e: MouseEvent) => {
      if (ours(e)) return
      e.preventDefault(); e.stopPropagation()
      const el = e.target as Element
      onDone({ target: describeSpot(el), rect: el.getBoundingClientRect() })
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onDone(null) } }
    document.addEventListener('mousemove', move, true)
    document.addEventListener('pointerdown', stop, true)
    document.addEventListener('mousedown', stop, true)
    document.addEventListener('mouseup', stop, true)
    document.addEventListener('click', click, true)
    document.addEventListener('keydown', key, true)
    document.body.style.cursor = 'crosshair'
    return () => {
      document.removeEventListener('mousemove', move, true)
      document.removeEventListener('pointerdown', stop, true)
      document.removeEventListener('mousedown', stop, true)
      document.removeEventListener('mouseup', stop, true)
      document.removeEventListener('click', click, true)
      document.removeEventListener('keydown', key, true)
      document.body.style.cursor = ''
    }
  }, [onDone])
  return (
    <>
      {box && <div data-req-ignore="" className="pointer-events-none fixed z-[100] rounded-md border-2 border-rose-600 bg-rose-500/10 transition-all duration-75"
        style={{ left: box.left - 3, top: box.top - 3, width: box.width + 6, height: box.height + 6 }} />}
      <div data-req-ignore="" className="fixed left-1/2 top-3 z-[101] flex -translate-x-1/2 items-center gap-3 rounded-full bg-foreground px-4 py-2 text-sm text-background shadow-lg">
        <Crosshair className="size-4" />{t('Click the spot on the page or in the menu')}
        <button type="button" className="rounded-full bg-background/15 px-2.5 py-0.5 text-xs hover:bg-background/25" onClick={() => onDone(null)}>{t('Cancel (Esc)')}</button>
      </div>
    </>
  )
}

/** the request window: what kind, the spot, the words, the AI's detailed version the person confirms, the picture */
export function RequestHost() {
  const { companyId } = useCompany()
  const on = useRequestsOn()
  const location = useLocation()
  const navigate = useNavigate()
  const submit = useSubmitRequest()
  const [open, setOpen] = React.useState(false)
  const [picking, setPicking] = React.useState(false)
  const [kind, setKind] = React.useState<RequestKind>('change')
  const [body, setBody] = React.useState('')
  const [target, setTarget] = React.useState<string | null>(null)
  const [picture, setPicture] = React.useState<Blob | null>(null)
  const [pictureUrl, setPictureUrl] = React.useState<string | null>(null)
  const [page, setPage] = React.useState({ path: '', title: '' })
  const [detail, setDetail] = React.useState<string | null>(null)
  const [confirmed, setConfirmed] = React.useState(false)
  const [writing, setWriting] = React.useState(false)
  const [snapping, setSnapping] = React.useState(false)
  const fileRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (!picture) { setPictureUrl(null); return }
    const u = URL.createObjectURL(picture); setPictureUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [picture])

  const reset = () => { setKind('change'); setBody(''); setTarget(null); setPicture(null); setDetail(null); setConfirmed(false) }
  const thisPage = () => ({ path: `${location.pathname}${location.search}`.slice(0, 300),
    title: clean(activePage()?.querySelector('h1')?.textContent || document.title, 200) })

  const start = React.useCallback(async (spot: string | null, pick: boolean) => {
    setPage(thisPage())
    if (pick) { setPicking(true); return }
    setTarget(spot)
    setSnapping(true)
    setPicture(await screenPicture())
    setSnapping(false)
    setOpen(true)
  }, [location.pathname, location.search]) // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent<{ target: string | null; pick: boolean }>).detail; void start(d?.target ?? null, !!d?.pick) }
    window.addEventListener(EVENT, h)
    return () => window.removeEventListener(EVENT, h)
  }, [start])

  const picked = React.useCallback(async (r: { target: string; rect: DOMRect } | null) => {
    setPicking(false)
    if (r) { setTarget(r.target); setSnapping(true); setPicture(await screenPicture(r.rect)); setSnapping(false) }
    setOpen(true)
  }, [])

  // a right click on a menu line: a request about that line (or the link in a new tab)
  const [menuAt, setMenuAt] = React.useState<{ x: number; y: number; target: string; href: string | null } | null>(null)
  React.useEffect(() => {
    if (!on.data) return
    const h = (e: MouseEvent) => {
      const el = e.target as Element | null
      if (!el?.closest?.('aside') || e.shiftKey) return
      e.preventDefault()
      const a = el.closest('a')
      setMenuAt({ x: e.clientX, y: e.clientY, target: describeSpot(el), href: a?.getAttribute('href') ?? null })
    }
    const close = () => setMenuAt(null)
    document.addEventListener('contextmenu', h)
    document.addEventListener('click', close)
    window.addEventListener('blur', close)
    return () => { document.removeEventListener('contextmenu', h); document.removeEventListener('click', close); window.removeEventListener('blur', close) }
  }, [on.data])

  const paste = (e: React.ClipboardEvent) => {
    const f = Array.from(e.clipboardData.files).find((x) => x.type.startsWith('image/'))
    if (f) { e.preventDefault(); setPicture(f) }
  }

  const writeOut = async () => {
    if (!companyId) return
    setWriting(true)
    try {
      setDetail(await writeOutInDetail(companyId, { kind, body: body.trim(), page_title: page.title, page_path: page.path, target, lang: getLocale() }))
      setConfirmed(false)
    } catch (e) { toast.error(tServer(describeError(e))) } finally { setWriting(false) }
  }

  const send = async () => {
    if (!companyId) return
    try {
      const r = await submit.mutateAsync({ company_id: companyId, kind, body: body.trim(), detail: confirmed ? detail : null,
        page_path: page.path, page_title: page.title, target, picture })
      toast.success(t('{no} was sent', { no: reqNo(r.number) }), { action: { label: t('See the requests'), onClick: () => navigate(`/requests?k=${r.number}`) } })
      reset(); setOpen(false)
    } catch (e) { toast.error(tServer(describeError(e))) }
  }

  if (!on.data) return null
  const waiting = detail != null && !confirmed
  return (
    <>
      {menuAt && (
        <div data-req-ignore="" role="menu" className="fixed z-[100] min-w-56 rounded-lg border bg-popover p-1 text-sm shadow-lg" style={{ left: menuAt.x, top: menuAt.y }}>
          <div className="truncate px-2.5 py-1.5 text-xs text-muted-foreground">{menuAt.target}</div>
          <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-muted"
            onClick={() => { const tg = menuAt.target; setMenuAt(null); void start(tg, false) }}><Lightbulb className="size-4 text-primary" />{t('Request about this menu line')}</button>
          {menuAt.href && <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-muted"
            onClick={() => { window.open(menuAt.href!, '_blank', 'noopener'); setMenuAt(null) }}>{t('Open in a new tab')}</button>}
        </div>
      )}
      {picking && <Picker onDone={(r) => void picked(r)} />}
      {snapping && <div data-req-ignore="" className="fixed bottom-4 left-1/2 z-[101] flex -translate-x-1/2 items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm text-background shadow-lg">
        <Loader2 className="size-4 animate-spin" />{t('Taking a picture of the screen…')}</div>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl" onPaste={paste}>
          <DialogHeader>
            <DialogTitle>{t('New request')}</DialogTitle>
            <DialogDescription>{t('On the page: {page}', { page: page.title || page.path })}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('Kind')}>
            {KINDS.map((k) => (
              <button key={k.key} type="button" role="radio" aria-checked={kind === k.key} onClick={() => setKind(k.key)}
                className={cn('rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors', kind === k.key ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted')}>
                {t(k.label)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
            <Crosshair className="size-4 shrink-0 text-muted-foreground" />
            <span className={cn('min-w-0 flex-1 truncate', !target && 'text-muted-foreground')}>{target ?? t('The whole page')}</span>
            {target && <button type="button" className="text-muted-foreground hover:text-foreground" aria-label={t('Remove the spot')} onClick={() => setTarget(null)}><X className="size-4" /></button>}
            <Button size="sm" variant="outline" onClick={() => { setOpen(false); setPicking(true) }}>{t('Point at the spot')}</Button>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="req-body">{t('What do you ask for?')}</Label>
            <Textarea id="req-body" rows={4} value={body} autoFocus maxLength={4000}
              onChange={(e) => { setBody(e.target.value); if (detail != null) setConfirmed(false) }}
              placeholder={t('With your own words: what to add, take out, change or join, and why.')} />
            <div>
              <Button size="sm" variant="outline" loading={writing} disabled={body.trim().length < 3} onClick={() => void writeOut()}>
                <Sparkles /> {detail == null ? t('Write it out in detail') : t('Write it out again')}
              </Button>
            </div>
          </div>
          {detail != null && (
            <div className={cn('grid gap-2 rounded-lg border p-3', confirmed ? 'border-success/40 bg-success/[0.06]' : 'border-primary/40 bg-primary/[0.04]')}>
              <div className="flex items-center gap-2 text-sm font-medium">
                {confirmed ? <Check className="size-4 text-success" /> : <Lightbulb className="size-4 text-primary" />}
                {confirmed ? t('Detailed request confirmed') : t('The AI wrote your request out. Read it, fix it if needed and confirm it.')}
              </div>
              <Textarea rows={8} value={detail} onChange={(e) => { setDetail(e.target.value); setConfirmed(false) }} aria-label={t('Detailed request')} />
              {!confirmed && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setConfirmed(true)}><Check /> {t('Yes, this is my request')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setDetail(null); setConfirmed(false) }}>{t('No, keep only my words')}</Button>
                </div>
              )}
            </div>
          )}
          <div className="flex items-center gap-3">
            {pictureUrl ? (
              <div className="relative">
                <a href={pictureUrl} target="_blank" rel="noopener"><img src={pictureUrl} alt={t('Picture of the screen')} className="h-20 rounded-md border object-cover" /></a>
                <button type="button" className="absolute -right-2 -top-2 rounded-full border bg-card p-0.5 shadow" aria-label={t('Remove the picture')} onClick={() => setPicture(null)}><X className="size-3.5" /></button>
              </div>
            ) : null}
            <div className="text-xs text-muted-foreground">
              <button type="button" className="flex items-center gap-1.5 text-primary hover:underline" onClick={() => fileRef.current?.click()}><ImagePlus className="size-4" />{pictureUrl ? t('Another picture') : t('Add a picture')}</button>
              <span>{t('Or paste one with Ctrl+V.')}</span>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setPicture(f); e.target.value = '' }} />
          </div>
          <DialogFooter className="items-center sm:justify-between">
            <Link to="/requests" className="text-sm text-primary hover:underline" onClick={() => setOpen(false)}>{t('All requests')}</Link>
            <div className="flex flex-col items-end gap-1">
              <Button loading={submit.isPending} disabled={body.trim().length < 3 || waiting} onClick={() => void send()}>{t('Send the request')}</Button>
              {waiting && <span className="text-xs text-muted-foreground">{t('Confirm the detailed request or keep only your words.')}</span>}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** the top bar's button */
export function RequestButton() {
  const on = useRequestsOn()
  if (!on.data) return null
  return (
    <Button variant="outline" size="sm" className="h-8 gap-1.5 border-primary/40 text-primary" data-req-ignore="" onClick={() => openRequest()} title={t('Ask for a change on this page')}>
      <Lightbulb /> <span className="max-lg:hidden">{t('Request|button')}</span>
    </Button>
  )
}
