import * as React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * Several pages of the same work shown as one page: the first one on top with its own header, the others
 * under it, each as a section with its heading. Under the first header, links jump to each section.
 * A section loads when it comes near the screen, so the page opens as fast as its first part.
 * The old address of each page leads to its section (see ToSection).
 */
export type StackSection = {
  id: string
  /** the name in the links at the top: a text key, translated when shown */
  label: string
  element: React.ReactNode
  /** who may see it, as the page's own route asked (e.g. "invoicing.read" or "pos.read|finance.read") */
  perm?: string
  /** its old address: the company's switched-off features hide it as they hid the page */
  path?: string
}

type Ctx = { id: string; first: boolean; links: React.ReactNode }
const SectionCtx = React.createContext<Ctx | null>(null)
/** inside a stacked page: the page header becomes a section heading (and the first one carries the links) */
export const useStackSection = () => React.useContext(SectionCtx)

export function useVisibleSections(sections: StackSection[]) {
  const { can, pageAllowed } = useCompany()
  return sections.filter((s) => (!s.perm || can(s.perm)) && (!s.path || pageAllowed(s.path)))
}

export function PageStack({ sections }: { sections: StackSection[] }) {
  const shown = useVisibleSections(sections)
  const { hash } = useLocation()
  const target = decodeURIComponent(hash.slice(1))
  // coming for one section (an old address, a link): it and everything above it load at once, so the page does not move under it
  const upTo = (id: string) => { const i = shown.findIndex((s) => s.id === id); return i < 0 ? [] : shown.slice(0, i + 1).map((s) => s.id) }
  const [open, setOpen] = React.useState<Set<string>>(() => new Set([shown[0]?.id, ...upTo(target)].filter(Boolean)))
  const mount = React.useCallback((id: string) => setOpen((o) => (o.has(id) ? o : new Set(o).add(id))), [])
  // keeps the section in view while the parts above it finish loading, until the person scrolls themselves
  const follow = React.useCallback((id: string, smooth: boolean) => {
    setOpen((o) => { const n = new Set(o); for (const x of upTo(id)) n.add(x); return n })
    let moved = false
    const stop = () => { moved = true }
    window.addEventListener('wheel', stop, { once: true, passive: true }); window.addEventListener('touchmove', stop, { once: true, passive: true })
    const timers = [80, 400, 900, 1600, 2600].map((ms, i) => window.setTimeout(() => {
      if (!moved) document.getElementById(id)?.scrollIntoView({ behavior: smooth && i === 0 ? 'smooth' : 'auto', block: 'start' })
    }, ms))
    return () => { timers.forEach((x) => window.clearTimeout(x)); window.removeEventListener('wheel', stop); window.removeEventListener('touchmove', stop) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown.map((s) => s.id).join()])
  const go = (id: string) => { follow(id, true) }
  React.useEffect(() => {
    if (!target || target === shown[0]?.id || !shown.some((s) => s.id === target)) return
    return follow(target, false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

  const links = shown.length > 1 ? (
    <nav aria-label="sections" className="mt-1 flex flex-wrap gap-1.5 print:hidden">
      {shown.map((s, i) => (
        <button key={s.id} type="button" onClick={() => (i === 0 ? window.scrollTo({ top: 0, behavior: 'smooth' }) : go(s.id))}
          className={cn('rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors hover:border-primary/50 hover:text-primary',
            i === 0 ? 'border-primary/40 bg-primary/10 text-primary' : 'bg-card text-muted-foreground')}>
          {t(s.label)}
        </button>
      ))}
    </nav>
  ) : null

  return (
    <>
      {shown.map((s, i) => (
        <SectionCtx.Provider key={s.id} value={{ id: s.id, first: i === 0, links: i === 0 ? links : null }}>
          <LazySection id={s.id} first={i === 0} open={open.has(s.id)} onNear={() => mount(s.id)}>{s.element}</LazySection>
        </SectionCtx.Provider>
      ))}
    </>
  )
}

function LazySection({ id, first, open, onNear, children }: { id: string; first: boolean; open: boolean; onNear: () => void; children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (open || !ref.current) return
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) onNear() }, { rootMargin: '600px 0px' })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [open, onNear])
  return (
    <section id={id} ref={ref} className={cn('scroll-mt-28', !first && 'mt-10 border-t pt-6')} style={open ? undefined : { minHeight: 320 }}>
      {open ? children : null}
    </section>
  )
}

/** the old address of a stacked page: to its section, keeping what was asked; without access to the whole page, the page alone */
export function ToSection({ to, section, perm, alone }: { to: string; section: string; perm?: string; alone: React.ReactNode }) {
  const { search } = useLocation()
  const { can, pageAllowed } = useCompany()
  if ((perm && !can(perm)) || !pageAllowed(to)) return <>{alone}</>
  return <Navigate replace to={`${to}${search}#${section}`} />
}
