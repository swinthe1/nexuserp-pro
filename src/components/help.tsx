import { ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, GraduationCap, Info, Lightbulb, MousePointerClick, TriangleAlert, X } from 'lucide-react'
import * as React from 'react'
import { createPortal } from 'react-dom'
import { Link, matchPath, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { t, useLocale } from '@/i18n'
import { GUIDES } from '@/i18n/help/guides'
import { TIPS } from '@/i18n/help/tips'
import type { Guide, L, TourStep } from '@/i18n/help/types'
import { ALL_LESSONS } from '@/i18n/help/training'
import { useMarkLesson } from '@/features/training/api'
import { cn } from '@/lib/utils'

function usePick() {
  const locale = useLocale()
  return React.useCallback((x: L) => (locale === 'sq' ? x.sq : x.en), [locale])
}

/** the guide of the page we are on: the most specific address that matches */
const KEYS = Object.keys(GUIDES).sort((a, b) => b.split('/').length - a.split('/').length || (a.includes(':') ? 1 : 0) - (b.includes(':') ? 1 : 0))
export function useGuide(): Guide | null {
  const { pathname } = useLocation()
  const key = KEYS.find((k) => matchPath({ path: k, end: true }, pathname))
  return key ? GUIDES[key]! : null
}

/* ------------------------------------------------------------------ the small ⓘ next to a page title */
export function PageHelpButton({ className }: { className?: string }) {
  const guide = useGuide()
  const pick = usePick()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const mark = useMarkLesson()
  // opened from the training page: the panel opens by itself, with "Lesson done" at the bottom
  const lesson = ALL_LESSONS.find((l) => l.key === params.get('learn'))
  const [open, setOpen] = React.useState(!!lesson)
  React.useEffect(() => { if (lesson) setOpen(true) }, [lesson])
  // "Show me" only walks through the parts this page shows right now (a posted document has no Save button);
  // when none of them is here, the button is not offered
  const [tour, setTour] = React.useState<TourStep[] | null>(null)
  React.useEffect(() => {
    if (!open || !guide?.tour?.length) { setTour(null); return }
    const look = () => {
      const here = guide.tour!.filter((s) => !s.target || findTarget(s.target))
      setTour(here.some((s) => s.target) ? here : null)
    }
    look()
    const later = setTimeout(look, 1200) // the page may still be loading when the panel opens
    return () => clearTimeout(later)
  }, [open, guide])
  if (!guide) return null
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={t('How this page works')} title={t('How this page works')}
        className={cn('inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring print:hidden', className)}>
        <Info className="size-[18px]" />
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2"><Info className="size-5 text-primary" /> {t('How this page works')}</SheetTitle>
            <SheetDescription className="text-[14px] leading-relaxed text-foreground">{pick(guide.what)}</SheetDescription>
          </SheetHeader>
          <div className="grid gap-5 px-5 pb-8 pt-5 text-[13.5px] leading-relaxed">
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('Step by step')}</h3>
              <ol className="grid gap-2">
                {guide.steps.map((s, i) => (
                  <li key={i} className="flex gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{i + 1}</span><span className="pt-0.5">{pick(s)}</span></li>
                ))}
              </ol>
            </section>
            {!!guide.mistakes?.length && (
              <section className="rounded-lg border border-warning/30 bg-warning/5 p-3">
                <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-warning"><TriangleAlert className="size-3.5" /> {t('Watch out')}</h3>
                <ul className="grid gap-1.5">{guide.mistakes.map((m, i) => <li key={i}>{pick(m)}</li>)}</ul>
              </section>
            )}
            {guide.after && (
              <section className="rounded-lg border bg-muted/40 p-3">
                <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><Lightbulb className="size-3.5" /> {t('What happens next')}</h3>
                <p>{pick(guide.after)}</p>
              </section>
            )}
            {!!guide.related?.length && (
              <section>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('Related pages')}</h3>
                <div className="flex flex-wrap gap-2">
                  {guide.related.map((r) => <Button key={r.href} size="sm" variant="outline" asChild onClick={() => setOpen(false)}><Link to={r.href}>{pick(r.label)} <ArrowRight /></Link></Button>)}
                </div>
              </section>
            )}
            {!!tour?.length && (
              <Button className="justify-self-start" variant={lesson ? 'outline' : 'default'} onClick={() => { setOpen(false); setTimeout(() => startTour(tour), 250) }}><MousePointerClick /> {t('Show me on the page')}</Button>
            )}
            {lesson && (
              <section className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-primary"><GraduationCap className="size-3.5" /> {t('Lesson')}: {pick(lesson.title)}</h3>
                <p className="mb-3 text-[13px]">{pick(lesson.why)}</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" loading={mark.isPending} onClick={async () => { await mark.mutateAsync({ lesson: lesson.key, done: true }); setOpen(false); navigate('/training') }}><CheckCircle2 /> {t('Lesson done')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setOpen(false); params.delete('learn'); setParams(params, { replace: true }) }}>{t('Try it on the page first')}</Button>
                </div>
              </section>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

/* ------------------------------------------------------------------ the small ⓘ next to a hard field */
export function Hint({ id, text, className }: { id?: keyof typeof TIPS | string; text?: L; className?: string }) {
  const pick = usePick()
  const tip = text ?? (id ? TIPS[id] : undefined)
  if (!tip) return null
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={t('What is this?')} onClick={(e) => e.stopPropagation()}
          className={cn('ml-1 inline-flex size-4 shrink-0 translate-y-[-1px] items-center justify-center rounded-full align-middle text-muted-foreground/60 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}>
          <Info className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" className="w-72 text-[13px] leading-relaxed">{pick(tip)}</PopoverContent>
    </Popover>
  )
}

/* ------------------------------------------------------------------ "Show me": a light over the page, step by step */
let tourSteps: TourStep[] | null = null
const listeners = new Set<() => void>()
export function startTour(steps: TourStep[]) { tourSteps = steps; listeners.forEach((l) => l()) }
function stopTour() { tourSteps = null; listeners.forEach((l) => l()) }
function useTour() { return React.useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb) }, () => tourSteps) }

/** finds the part of the page a step points at: a selector, or the visible text of a button, tab, heading or field label */
function findTarget(target: string | undefined): HTMLElement | null {
  if (!target) return null
  try { const el = document.querySelector<HTMLElement>(target); if (el && el.offsetParent !== null) return el } catch { /* not a selector */ }
  const want = t(target).trim().toLowerCase()
  const nodes = [...document.querySelectorAll<HTMLElement>('button, [role=tab], label, h2, h3, th, a')].filter((n) => n.offsetParent !== null && !n.closest('[role=dialog], aside'))
  const text = (n: HTMLElement) => ((n.textContent ?? '').trim() || n.getAttribute('aria-label') || '').trim().toLowerCase()
  const hit = nodes.find((n) => text(n) === want) ?? nodes.find((n) => text(n).startsWith(want))
  if (!hit) return null
  // a field label points at the whole field (the label with its input)
  if (hit.tagName === 'LABEL') return (hit.closest('[class*="grid"], [class*="space-y"]') as HTMLElement | null) ?? hit
  return hit
}

export function TourHost() {
  const steps = useTour()
  const pick = usePick()
  const [i, setI] = React.useState(0)
  const [rect, setRect] = React.useState<DOMRect | null>(null)
  React.useEffect(() => { setI(0) }, [steps])
  const step = steps?.[i]
  React.useLayoutEffect(() => {
    if (!step) return
    const el = findTarget(step.target)
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const measure = () => setRect(el ? el.getBoundingClientRect() : null)
    const id = setTimeout(measure, el ? 320 : 0)
    window.addEventListener('resize', measure); window.addEventListener('scroll', measure, true)
    return () => { clearTimeout(id); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true) }
  }, [step])
  React.useEffect(() => {
    if (!steps) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') stopTour(); if (e.key === 'ArrowRight') setI((x) => Math.min(x + 1, steps.length - 1)); if (e.key === 'ArrowLeft') setI((x) => Math.max(x - 1, 0)) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [steps])
  if (!steps || !step) return null
  const pad = 6
  const box = rect ? { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 } : null
  const below = box ? box.top + box.height + 190 < window.innerHeight : true
  const cardStyle: React.CSSProperties = box
    ? { top: below ? box.top + box.height + 12 : Math.max(12, box.top - 12 - 170), left: Math.min(Math.max(12, box.left), window.innerWidth - 332) }
    : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
  const last = i === steps.length - 1
  return createPortal(
    <div className="fixed inset-0 z-[100]" role="dialog" aria-label={t('Show me on the page')}>
      {box
        ? <div className="pointer-events-none absolute rounded-lg ring-2 ring-primary transition-all duration-300" style={{ ...box, boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.55)' }} />
        : <div className="absolute inset-0 bg-black/55" />}
      <div className="absolute w-80 rounded-xl border bg-card p-4 shadow-xl" style={cardStyle}>
        <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
          <span>{t('Step {n} of {total}', { n: i + 1, total: steps.length })}</span>
          <button type="button" aria-label={t('Close')} onClick={stopTour} className="rounded p-0.5 hover:bg-muted"><X className="size-4" /></button>
        </div>
        <p className="text-[14px] leading-relaxed">{pick(step.say)}</p>
        {!rect && step.target && <p className="mt-1 text-xs text-muted-foreground">{t('This part is not on the screen right now.')}</p>}
        <div className="mt-3 flex items-center justify-between">
          <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => setI(i - 1)}><ChevronLeft /> {t('Back')}</Button>
          {last ? <Button size="sm" onClick={stopTour}>{t('Done')}</Button> : <Button size="sm" onClick={() => setI(i + 1)}>{t('Next')} <ChevronRight /></Button>}
        </div>
      </div>
    </div>,
    document.body,
  )
}
